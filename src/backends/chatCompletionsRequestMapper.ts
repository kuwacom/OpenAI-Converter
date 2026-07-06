import type { CanonicalRequest } from '@/models/canonical/response';
import type { CanonicalMessage } from '@/models/canonical/message';
import type { CanonicalTool } from '@/models/canonical/tool';
import { safeJsonParse } from '@/lib/jsonUtils';
import type {
  ChatCompletionMessage,
  ChatCompletionRequest,
} from '@/models/chatCompletionsModel';
import logger from '@/services/logger';

// 上流へ転送する関数ツールの JSON Schema 形状。
// 標準的な OpenAI ツール形式のまま渡すことで、upstream 側 function calling を最大限活用する
const buildUpstreamFunctionTool = (
  tool: CanonicalTool,
): Record<string, unknown> => ({
  type: 'function',
  function: {
    name: tool.wireName,
    description: tool.description ?? tool.name,
    parameters: tool.parameters ?? { type: 'object', properties: {} },
    ...(typeof tool.strict === 'boolean' ? { strict: tool.strict } : {}),
  },
});

// custom/mcp/builtin 等、OpenAI 関数ツールに直接詰められない種別は
// 単一文字列入力または種別別 JSON 入力を受け取る関数ラッパーとして上流へ提示する。
// 復号結果は応答側で元の canonical 形式へ再構築する(response-mapper 参照)
const buildSyntheticFunctionWrapper = (
  tool: CanonicalTool,
): Record<string, unknown> => ({
  type: 'function',
  function: {
    name: tool.wireName,
    description:
      tool.description ??
      `${tool.originalType ?? tool.type} routed through proxy`,
    parameters: buildSyntheticWrapperParameters(tool),
  },
});

/**
 * ### buildSyntheticWrapperParameters
 * 合成関数ラッパーの引数 JSON Schema を builtin 種別に応じて生成する。
 *
 * - web_search: 既存 injectWebSearchContext 側で専用定義を追加済みのためここでは generic 単一 input 文字列を採用(action/query/url を文字列化 JSON で受け取る)
 * - tool_search: execution(検索実行方法) + query(検索語) + tools(候補配列) を緩く受領
 * - local_shell: action オブジェクト(command/env/cwd 等)を受領(codex LocalShellAction 準拠)
 * - image_generation: prompt + output_format(none/png 等可选) を受領
 * - 上記以外(custom/mcp/unknown): 単一 input 文字列(従来通り)
 */
const buildSyntheticWrapperParameters = (
  tool: CanonicalTool,
): Record<string, unknown> => {
  // リクエスト由来 parameters があればそれを優先(web_search search_context_size 等のメタ保持のため)
  const baseParams =
    (tool.parameters as Record<string, unknown> | undefined) ?? undefined;

  if (tool.builtinKind === 'tool_search') {
    return baseParams ?? {
      type: 'object',
      properties: {
        execution: { type: 'string', description: 'Tool discovery execution mode. Defaults to "search".' },
        query: { type: 'string', description: 'Search query text used to find matching deferred tool definitions.' },
      },
      required: ['query'],
    };
  }

  if (tool.builtinKind === 'local_shell') {
    return baseParams ?? {
      type: 'object',
      properties: {
        action: {
          type: 'object',
          description: 'Shell action to execute (command, env, cwd, etc).',
          properties: {
            command: { type: 'array', items: { type: 'string' } },
            env: { type: 'object' },
            working_dir: { type: 'string' },
          },
          required: ['command'],
        },
      },
      required: ['action'],
    };
  }

  if (tool.builtinKind === 'image_generation') {
    return baseParams ?? {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Image generation prompt text.' },
        output_format: { type: 'string', enum: ['png', 'webp'], description: 'Output image format.' },
      },
      required: ['prompt'],
    };
  }

  // web_search / custom / mcp / unknown は従来通り単一入力文字列ラッパー。
  // web_search は既存 injectWebSearchContext が合成関数を追加して action/query/url を明示 Schema 定義しているため、ここでの到達は二重定義防止観点から generic 化する
  return baseParams ?? {
    type: 'object',
    properties: {
      input: {
        type: 'string',
        description: `Freeform payload for ${tool.wireName}`,
      },
    },
    required: ['input'],
  };
};

/**
 * ### buildChatCompletionTools
 * 上流が認識できる OpenAI 形式ツール配列へ正規化する。
 * Responses 由来の特殊型は一旦単一入力文字列の関数ラッパー化する。
 */
export const buildChatCompletionTools = (
  tools: readonly CanonicalTool[],
): Record<string, unknown>[] =>
  tools.map((tool) =>
    tool.type === 'function'
      ? buildUpstreamFunctionTool(tool)
      : buildSyntheticFunctionWrapper(tool),
  );

type ContentPart = CanonicalMessage['content'][number];

const extractPlainText = (parts: ReadonlyArray<ContentPart>): string =>
  parts
    .filter(
      (part): part is Extract<ContentPart, { type: 'text' }> =>
        part.type === 'text',
    )
    .map((part) => part.text)
    .join('');

const safeStringify = (value: unknown): string => {
  try {
    return JSON.stringify(value);
  } catch {
    return '{}';
  }
};

/**
 * ### ensureValidWireArguments
 * 関数ツールの引数文字列を上流 ChatCompletions が受理できる valid JSON へ保証する。
 *
 * 一度でも上流モデルが不正な JSON 引数を出力すると、それが Codex 履歴(responseStore 含む)へ残り、
 * 以降の resume 再開ですべて再送され永続的に 400 で拒否され続ける致命バグを防ぐための最終防波堤。
 * 情報落ちを防ぐため、壊れた生テキストは破棄せず {_malformedArguments:"..."} 形式へ包んで valid JSON 化する
 *
 * @param argsSource - 整形対象の候補文字列(rawArguments 優先、無ければ arguments 文字列)
 * @param toolName - ログ識別用のツール名
 * @returns 上流が JSON parse 可能なことが保証された arguments 文字列
 */
const ensureValidWireArguments = (
  argsSource: string,
  toolName: string,
): string => {
  // 空文字列は strict プロバイダが空 arguments を拒否することがあるため空オブジェクトへ正規化する
  if (argsSource.length === 0) return '{}';

  // 既に valid JSON なら多重エンコード防止のため構造を保ったまま素通しする
  if (safeJsonParse(argsSource) !== undefined) return argsSource;

  // 不正 JSON の場合、内容を捨てず包んで valid JSON 化する
  logger.warn(
    'Encountered malformed tool_call.arguments; wrapping to preserve content for upstream',
    { toolName, rawLength: argsSource.length },
  );
  return safeStringify({ _malformedArguments: argsSource });
};

// Custom(Freeform) ツール用 arguments を上流 CC の期待形態(JSON 文字列)へ整える。
// apply_patch 等の素テキスト入力は {input:<raw>} 形式に再エンコードしないと
// upstream が function.arguments を JSON parse できず 400 を返すため
const toWireFunctionArguments = (call: {
  type: string;
  name: string;
  wireName?: string;
  arguments?: unknown;
  rawArguments?: string;
}): string => {
  const isCustom = call.type === 'custom';
  const argsSource =
    typeof call.rawArguments === 'string'
      ? call.rawArguments
      : typeof call.arguments === 'string'
        ? (call.arguments as string)
        : '';
  if (isCustom) {
    return safeStringify({ input: argsSource });
  }
  // custom 系以外は候補(rawArguments 優先、無ければ arguments 文字列)を valid JSON へ保証する。
  // responseStore や Codex 履歴由来の過去ターン tool_call 引数が一度でも壊れると、以降再送時に永続的に 400 になるため
  // rawArguments 未所持時のみ arguments(object 含む)を JSON 文字列化した候補を使用する
  const candidate =
    typeof call.rawArguments === 'string'
      ? call.rawArguments
      : typeof call.arguments === 'string'
        ? (call.arguments as string)
        : safeStringify(call.arguments ?? {});
  return ensureValidWireArguments(candidate, call.wireName || call.name);
};

// content_part 配列を ChatCompletions 用 content へ変換する
// テキスト以外は出来るだけ provider が解釈可能な形状へ、不可ならテキストフォールバックする
const renderPart = (part: ContentPart): Record<string, unknown>[] => {
  switch (part.type) {
    case 'text':
      return [{ type: 'text', text: part.text }];
    case 'image': {
      const url =
        part.imageUrl ??
        (part.raw &&
        typeof part.raw === 'object' &&
        !Array.isArray(part.raw) &&
        typeof (part.raw as Record<string, unknown>).image_url === 'string'
          ? ((part.raw as Record<string, unknown>).image_url as string)
          : '');
      return url ? [{ type: 'image_url', image_url: { url } }] : [];
    }
    case 'file':
      // CC 仕様上直接表現がないため内容を失わない範囲でテキストフォールバックする
      return [
        {
          type: 'text',
          text: `[unsupported file content:${part.fileId ?? part.fileUrl ?? ''}]`,
        },
      ];
    case 'reasoning':
      // 推論パートは前ターンの要約であり送信不要。次回モデル状態には含めない
      return [];
    case 'raw':
      try {
        return [{ type: 'text', text: JSON.stringify(part.raw) }];
      } catch {
        return [];
      }
    default:
      // 網羅性保証用。新しい種別追加時ここを通す
      return [];
  }
};

const CONTENT_ONLY_ROLES = new Set(['system', 'developer']);

/**
 * ### toChatCompletionMessages
 * canonical messages をそのまま上位互換の OpenAI メッセージ配列へ詰め替える
 */
export const toChatCompletionMessages = (
  messages: ReadonlyArray<CanonicalMessage>,
): ChatCompletionMessage[] =>
  messages.map((message): ChatCompletionMessage => {
    const isContentOnlyRole = CONTENT_ONLY_ROLES.has(message.role);

    // アシスタントによるネイティブ関数呼び出し(後続 role=tool メッセージと対)
    if (
      !isContentOnlyRole &&
      message.toolCalls &&
      message.toolCalls.length > 0
    ) {
      const visibleText = extractPlainText(message.content);
      return {
        role: message.role,
        content: visibleText || null,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.callId,
          type: 'function',
          function: {
            // 上流 wrapper は wireName ベースで登録されているためそちらを優先する
            name: call.wireName || call.name,
            arguments: toWireFunctionArguments(call),
          },
        })),
      };
    }

    // 直前アシスタント呼び出し結果(role=tool)
    if (!isContentOnlyRole && message.role === 'tool') {
      return {
        role: 'tool',
        content: extractPlainText(message.content),
        ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
      };
    }

    const parts = message.content.flatMap(renderPart);

    // マルチモーダル対応ロール(user 等)は parts 配列 content を優先
    if (parts.length > 0 && !isContentOnlyRole && message.role !== 'system') {
      return { role: message.role, content: parts };
    }

    // system/developer や全滅ケースはプレーン文字列 content を返す
    return { role: message.role, content: extractPlainText(message.content) };
  });

/**
 * ### stringifyMessageContent
 * 上流 CC message の content を文字列へ正規化する。
 * string / parts 配列 / null いずれの形状も受け付け、純テキスト成分のみ抽出して返す。
 * 連続 assistant 統合時に双方の可視テキスト欠落を防ぐため使用する
 */
const stringifyMessageContent = (
  content:
    | ChatCompletionMessage['content']
    | readonly unknown[],
): string => {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  return content
    .flatMap((part): string[] => {
      if (!part || typeof part !== 'object') return [];
      const rec = part as Record<string, unknown>;
      const t = typeof rec.type === 'string' ? rec.type : '';
      // text / input_text / output_text の各パーツを持つ場合、その text 値を採用する
      if (
        (t === 'text' || t === 'input_text' || t === 'output_text') &&
        typeof rec.text === 'string'
      ) {
        return [rec.text];
      }
      return [];
    })
    .join('');
};

/**
 * ### mergeConsecutiveAssistantMessages
 * 連続する assistant メッセージを1つへ統合する。
 *
 * Responses API の1ターン产出(message + 複数 function_call 等)を Codex が次回 input item 配列として個別返送してくる際、
 * 当プロキシ内部では別々の canonical assistant メッセージへ分解されてしまう。
 * OpenAI strict 系列(/v1/chat/completions)は「assistant → assistant」の連続を許容しないプロバイダが多く、400 を引き起こすため事前に吸収する。
 * 統合時は visible text 優先かつ空なら null、tool_calls は両者を結合する(tool_call_id の対応関係は保持される)
 */
const mergeConsecutiveAssistantMessages = (
  messages: readonly ChatCompletionMessage[],
): ChatCompletionMessage[] => {
  const result: ChatCompletionMessage[] = [];
  for (const msg of messages) {
    const prev = result[result.length - 1];

    if (!prev || prev.role !== 'assistant' || msg.role !== 'assistant') {
      result.push(msg);
      continue;
    }

    // 配列形式 content(parts 配列)も取り得るため、文字列化してから比較・保持する
    const prevText = stringifyMessageContent(prev.content);
    const currText = stringifyMessageContent(msg.content);
    const prevToolCalls = Array.isArray(prev.tool_calls)
      ? prev.tool_calls
      : [];
    const currToolCalls = Array.isArray(msg.tool_calls)
      ? msg.tool_calls
      : [];
    const mergedToolCalls = [...prevToolCalls, ...currToolCalls];

    result[result.length - 1] = {
      ...prev,
      content: prevText || currText || null,
      ...(mergedToolCalls.length > 0 ? { tool_calls: mergedToolCalls } : {}),
    };
  }

  return result;
};

/**
 * ### sanitizeChatCompletionMessages
 * 上流送信前に不正形状になり得る部分を是正する最終防波堤。
 * 現状は連続 assistant 統合のみだが、今後の防御要件増大時にここへ集約する想定
 */
const sanitizeChatCompletionMessages = (
  messages: readonly ChatCompletionMessage[],
): ChatCompletionMessage[] =>
  mergeConsecutiveAssistantMessages([...messages]);

// canonical tool_choice の union を OpenAI CC 受容形態へ寄せる
const mapToolChoice = (request: CanonicalRequest): unknown => {
  const choice = request.toolChoice;
  if (choice === undefined || choice === null) return undefined;
  if (typeof choice !== 'object' || Array.isArray(choice)) return choice;

  const rec = choice as Record<string, unknown>;
  const name = typeof rec.name === 'string' ? rec.name : undefined;
  const recType = typeof rec.type === 'string' ? rec.type : undefined;

  if (
    !recType ||
    recType === 'auto' ||
    recType === 'none' ||
    recType === 'required'
  ) {
    return recType;
  }
  if (!name) return recType;

  return { type: 'function', function: { name } };
};

const mapResponseFormat = (
  request: CanonicalRequest,
): Record<string, unknown> | undefined => {
  const format = request.text?.format;
  if (!format || typeof format !== 'object' || Array.isArray(format)) {
    return undefined;
  }
  return toChatCompletionsResponseFormat(format as Record<string, unknown>);
};

/**
 * ### toChatCompletionsResponseFormat
 * Responses API 形式の text.format を Chat Completions 形式 response_format へ変換する。
 *
 * 両 API で形状が異なる:
 * - Responses:       { type:"json_schema", name, schema, strict } (フラット)
 * - ChatCompletions: { type:"json_schema", json_schema: { name, schema, strict } } (ネスト)
 *
 * フラットのまま流すと上流(litellm/NIM 等)の response_format.json_schema 必須フィールドデシリアライザで 400 を返すため正規化必須。
 * type=json_object / text 等その他形状はそのまま通す(上流互換のため)
 */
const toChatCompletionsResponseFormat = (
  format: Record<string, unknown>,
): Record<string, unknown> => {
  if (typeof format.type !== 'string') return format;

  // json_schema 形状のみネスト化必須。それ以外はそのまま通す
  if (format.type !== 'json_schema') return format;

  // 既に json_schema ネスト形式なら二重ラップ回避
  if (
    typeof format.json_schema === 'object' &&
    format.json_schema !== null &&
    !Array.isArray(format.json_schema)
  ) {
    return format;
  }

 // Responses のフラット name/schema/strict を CC ネスト形式 json_schema 配下へ移動する
  const { type: _type, ...rest } = format;
  void _type;
  // codex VSCode 拡張等は Responses API 経由で schema を JSON 文字列として送ってくるケースがある。
  // SGLang 等 strict 上流は response_format.json_schema.schema を辞書型必須とし文字列を拒否するため、
  // 文字列受領時は safeJsonParse 相当でオブジェクトへ復元する(失敗時はそのまま通す)
  return { type: 'json_schema', json_schema: normalizeSchemaField(rest) };
};

/**
 * ### normalizeSchemaField
 * json_schema 配下 rest オブジェクト内 schema フィールドが JSON 文字列の場合、
 * オブジェクトへ復元する。SGLang 等 strict 上流の dict_type バリデーション回避用。
 * 失敗時や文字列以外の場合はそのまま返す(上流エラー任せ)
 */
const normalizeSchemaField = (rest: Record<string, unknown>): Record<string, unknown> => {
  if (typeof rest.schema !== 'string') return rest;
  const parsed = safeJsonParse<Record<string, unknown>>(rest.schema);
  if (!parsed || typeof parsed !== 'object') return rest;
  return { ...rest, schema: parsed };
};

export type ChatCompletionRequestMapping = ReturnType<
  typeof mapToChatCompletions
>;

/**
 * ### mapToChatCompletions
 * CanonicalRequest -> 上流向け Chat Completions Request へ変換する
 *
 * @param request 変換前 canonical リクエスト
 * @param backendModel override 用上流モデル名(未指定なら canonical.model 利用)
 * @returns 変換結果(request 本体とデバッグ用プレビュー)
 */
export const mapToChatCompletions = (
  request: CanonicalRequest,
  backendModel?: string,
): { request: ChatCompletionRequest; preview: string } => ({
  request: {
    model: backendModel ?? request.model,
    messages: sanitizeChatCompletionMessages(
      toChatCompletionMessages(request.messages),
    ),
    tools:
      request.tools.length > 0
        ? buildChatCompletionTools(request.tools)
        : undefined,
    tool_choice: mapToolChoice(request),
    parallel_tool_calls: request.parallelToolCalls,
    stream: request.stream,
    temperature: request.temperature,
    top_p: request.topP,
    max_tokens: request.maxOutputTokens,
    response_format: mapResponseFormat(request),
    ...(request.reasoning?.effort
      ? { reasoning_effort: request.reasoning.effort }
      : {}),
  },
  preview: `[cc-request:${request.id}] messages=${request.messages.length}`,
});

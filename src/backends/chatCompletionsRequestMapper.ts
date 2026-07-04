import type { CanonicalRequest } from '@/models/canonical/response';
import type { CanonicalMessage } from '@/models/canonical/message';
import type { CanonicalTool } from '@/models/canonical/tool';
import type {
  ChatCompletionMessage,
  ChatCompletionRequest,
} from '@/models/chatCompletionsModel';

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
// 単一文字列入力を受け取る関数ラッパーとして上流へ提示する。
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
    parameters: {
      type: 'object',
      properties: {
        input: {
          type: 'string',
          description: `Freeform payload for ${tool.wireName}`,
        },
      },
      required: ['input'],
    },
  },
});

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
  return call.rawArguments ?? safeStringify(call.arguments ?? {});
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
  return format as Record<string, unknown>;
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
import type {
  CanonicalRequest,
  CanonicalResponse,
  CanonicalResponseOutput,
} from '@/models/canonical/response';
import type { OpenAIResponse } from '@/models/responsesModel';
import { createMessageId } from '@/lib/ids';
import { safeJsonParse, toJsonString } from '@/lib/jsonUtils';

const toUsage = (response: CanonicalResponse) => {
  if (!response.usage) {
    return null;
  }

  return {
    input_tokens: response.usage.inputTokens ?? 0,
    output_tokens: response.usage.outputTokens ?? 0,
    total_tokens:
      response.usage.totalTokens ??
      (response.usage.inputTokens ?? 0) + (response.usage.outputTokens ?? 0),
    ...(response.usage.reasoningTokens
      ? { output_tokens_details: { reasoning_tokens: response.usage.reasoningTokens } }
      : {}),
  };
};

const toMessageOutputItem = (
  output: Extract<CanonicalResponseOutput, { kind: 'message' }>,
) => ({
  id: output.id,
  type: 'message',
  status: output.status,
  role: output.role,
  content: output.content.flatMap((part: (typeof output.content)[number]) => {
    if (part.type === 'text') {
      return [
        {
          type: 'output_text',
          text: part.text,
          annotations: part.annotations ?? [],
        },
      ];
    }

    if (part.type === 'reasoning') {
      return [];
    }

    return [
      {
        type: 'output_text',
        text: `[non-text-content:${part.type}]`,
        annotations: [],
      },
    ];
  }),
});

/**
 * ### toWebSearchCallOutputItem
 * web_search_call アイテムへ変換。Codex 本体は non-tool 扱いで TurnItem::WebSearch へマップする
 */
const toWebSearchCallOutputItem = (
  output: Extract<CanonicalResponseOutput, { kind: 'web_search_call' }>,
) => ({
  id: output.id,
  type: 'web_search_call',
  status: output.status,
  ...(output.action ? { action: output.action } : {}),
});

const toToolCallOutputItem = (
  output: Extract<CanonicalResponseOutput, { kind: 'tool_call' }>,
) => {
  const toolCall = output.toolCall;

  if (toolCall.type === 'function') {
    // namespace 子関数は name=子単独名 + namespace=親名前空間名 の往復形(codex-relay 慣習)
    const fnBase = {
      id: output.id,
      type: 'function_call' as const,
      call_id: toolCall.callId,
      name: toolCall.name,
      arguments:
        toolCall.rawArguments ?? toJsonString(toolCall.arguments, '{}'),
      status: output.status,
    };
    return toolCall.parentNamespace
      ? { ...fnBase, namespace: toolCall.parentNamespace }
      : fnBase;
  }

  if (toolCall.type === 'custom') {
    // custom ツール(apply_patch 等)の引数は素テキスト。JSON ラップ解除必須
    const argsIsString = typeof toolCall.arguments === 'string';
    return {
      id: output.id,
      type: 'custom_tool_call',
      call_id: toolCall.callId,
      name: toolCall.name,
      input:
        typeof toolCall.rawArguments === 'string'
          ? toolCall.rawArguments
          : argsIsString
            ? (toolCall.arguments as string)
            : toJsonString(toolCall.arguments ?? '', ''),
      status: output.status,
    };
  }

  if (toolCall.type === 'mcp') {
    return {
      id: output.id,
      type: 'mcp_call',
      call_id: toolCall.callId,
      name: toolCall.name,
      arguments: toolCall.arguments ?? null,
      status: output.status,
    };
  }

  // builtin 合成関数経由呼出。builtinKind 別 *_call 形式 non-tool アイテム(Codex TUI 表示整合用 stub)
  const argsStr =
    typeof toolCall.rawArguments === 'string'
      ? toolCall.rawArguments
      : toJsonString(toolCall.arguments ?? {}, '{}');

 if (toolCall.builtinKind === 'tool_search') {
   const parsedArgs = safeJsonParse<Record<string, unknown>>(argsStr) ?? {};
    // codex は execution をトップレベルフィールドとして独立保持するため、
    // arguments オブジェクトからは execution を除外する(重複回避)
    const { execution: _exec, ...searchArguments } = parsedArgs;
   return {
     id: output.id,
     type: 'tool_search_call',
     call_id: toolCall.callId,
     status: output.status,
      execution:
        typeof _exec === 'string' ? _exec : 'search',
      arguments: searchArguments,
   };
 }

 if (toolCall.builtinKind === 'local_shell') {
   const parsedArgs = safeJsonParse<Record<string, unknown>>(argsStr) ?? {};
    // codex LocalShellAction は #[serde(tag="type")] で type:"exec" を必須とする。
    // 上流モデルが action.type を省略した場合は補完する
    const rawAction =
      (parsedArgs.action as Record<string, unknown> | undefined) ?? {};
    const action = { type: 'exec', ...rawAction };
   return {
     id: output.id,
     type: 'local_shell_call',
     call_id: toolCall.callId,
     status: output.status,
      action,
   };
 }

  if (toolCall.builtinKind === 'image_generation') {
    const parsedArgs = safeJsonParse<Record<string, unknown>>(argsStr) ?? {};
    return {
      id: output.id,
      type: 'image_generation_call',
      status: output.status,
      revised_prompt:
        typeof parsedArgs.prompt === 'string' ? parsedArgs.prompt : undefined,
      result:
        typeof parsedArgs.output_format === 'string'
          ? 'image_generation is not supported by this proxy'
          : '',
    };
  }

  // generic フォールバック
  const itemType = toolCall.originalType?.endsWith('_call')
    ? toolCall.originalType
    : `${toolCall.originalType ?? toolCall.name}_call`;

  return {
    id: output.id,
    type: itemType,
    call_id: toolCall.callId,
    name: toolCall.name,
    arguments: toolCall.arguments ?? null,
    status: output.status,
  };
};

const toReasoningOutputItem = (
  output: Extract<CanonicalResponseOutput, { kind: 'reasoning' }>,
  isContentMode: boolean,
) => ({
  id: output.id,
  type: 'reasoning',
  status: output.status,
  // reasoning.summary="none" 時は summary を空にし content へ格納する
  ...(isContentMode
    ? {
        summary: [],
        content: [{ type: 'reasoning_text', text: output.text }],
      }
    : {
        summary: [{ type: 'summary_text', text: output.text }],
      }),
  encrypted_content: output.encryptedContent ?? null,
});

type OpenAIResponseOutputItem = OpenAIResponse['output'][number];

const toOutputItem = (
  output: CanonicalResponseOutput,
  isContentMode: boolean,
): OpenAIResponseOutputItem => {
  if (output.kind === 'message') {
    return toMessageOutputItem(output);
  }

  if (output.kind === 'tool_call') {
    return toToolCallOutputItem(output);
  }

  if (output.kind === 'web_search_call') {
    return toWebSearchCallOutputItem(output);
  }

  return toReasoningOutputItem(output, isContentMode);
};

/**
 * ### createInProgressOpenAIResponse
 * ストリーミング開始時 response.created ペイロード。
 *
 * codex-relay 実測仕様に準拠し極小化:{id, object:"response", status:"in_progress", model} のみ送る。
 * Codex クライアントはここから前回状態再利用しないため、余分メタデータは逆に誤動作を招く
 */
export const createInProgressOpenAIResponse = (
  request: CanonicalRequest,
): OpenAIResponse => ({
  id: request.id,
  object: 'response',
  status: 'in_progress',
  model: request.model,
}) as OpenAIResponse;

/**
 * ### toOpenAIResponse
 * 最終応答を OpenAI Responses 形式へ変換。
 *
 * codex-relay ResponsesResponse 型通り、最小限 fields のみ出力する(id/object/model/output/usage)。
 * 不要な tools/tool_choice/reasoning/text/instructions 等を含めると Codex VSCode 拡張が依存して破綻するため除去
 */
export const toOpenAIResponse = (
  request: CanonicalRequest,
  response: CanonicalResponse,
): OpenAIResponse => {
  const isContentMode = request.reasoning?.summary === 'none';
  return ({
    id: response.id,
    object: 'response',
    model: response.model,
    output: response.output.map((output: CanonicalResponseOutput) =>
      toOutputItem(output, isContentMode),
    ),
    usage: toUsage(response),
    // ストリーミングで completed_at 必要ケースのため補完可能。非stream時は未設定可(undefined)
    ...(response.completedAt
      ? { completed_at: response.completedAt }
      : {}),
    ...(response.status !== 'completed'
      ? { status: response.status }
      : {}),
    // incomplete_details / error を応答失敗時のみ付与(codex-relay 同様に成功時省略)
    ...(response.incompleteDetails
      ? { incomplete_details: response.incompleteDetails }
      : {}),
    ...(response.error != null
      ? { error: response.error }
      : {}),
 }) as OpenAIResponse;

}

export const getAssistantTextFromResponse = (response: OpenAIResponse) => {
  const messageItem = response.output.find(
    (item: Record<string, unknown>) => item.type === 'message',
  );

  if (!messageItem || !Array.isArray(messageItem.content)) {
    return '';
  }

  return messageItem.content
    .filter(
      (
        contentItem: Record<string, unknown>,
      ): contentItem is { type: 'output_text'; text: string } =>
        contentItem.type === 'output_text' &&
        typeof contentItem.text === 'string',
    )
    .map(
      (contentItem: { type: 'output_text'; text: string }) => contentItem.text,
    )
    .join('');
};

/** stream 中 message item 用 helper(空テキスト done 用) */
export const createSyntheticAssistantMessageOutput = (text: string) => ({
  id: createMessageId(),
  type: 'message' as const,
  status: 'completed',
  role: 'assistant',
  content: [
    {
      type: 'output_text',
      text,
      annotations: [],
    },
  ],
});

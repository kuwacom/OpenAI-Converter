import type {
  CanonicalRequest,
  CanonicalResponse,
  CanonicalResponseOutput,
} from '@/models/canonical/response';
import type { OpenAIResponse } from '@/models/responsesModel';
import { createMessageId } from '@/lib/ids';
import { toJsonString } from '@/lib/jsonUtils';

const toUsage = (response: CanonicalResponse) => {
  if (!response.usage) {
    return null;
  }

  return {
    input_tokens: response.usage.inputTokens ?? 0,
    input_tokens_details: {
      cached_tokens: 0,
    },
    output_tokens: response.usage.outputTokens ?? 0,
    output_tokens_details: {
      reasoning_tokens: response.usage.reasoningTokens ?? 0,
    },
    total_tokens:
      response.usage.totalTokens ??
      (response.usage.inputTokens ?? 0) + (response.usage.outputTokens ?? 0),
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
          // web_search 利用時にパートへ付与された url_citation 注釈をそのまま反映する。
          // OpenAI 本家同様 output_text content へ紐づく形式とし Codex CLI 引用リンク表示に供する
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
 * CanonicalOutputWebSearchCall を OpenAI Responses 形式 web_search_call アイテムへ変換する。
 * 公式仕様準拠形状: {id, type:"web_search_call", status, action?}。
 * Codex 本体はこれを non-tool 扱いで TurnItem::WebSearch へマッピングする(UI 上「Searched」表示に使用)
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
    // 名前空間(namespace)の子関数として展開されていた場合、Responses 形式へ namespace フィールドを復元する。
    // codex-relay 実測慣習に準拠し、type=function_call のまま name=子単独名 + namespace=親名前空間名 を付与する往復形とする
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
    // arguments は custom ツールの場合、素のテキスト(apply_patch なら "*** Begin Patch ...")を保持している前提。
    // 万が一オブジェクト化されていたら toJSONString 化せずテキスト成分のみを取り出す。
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
) => ({
  id: output.id,
  type: 'reasoning',
  status: output.status,
  summary: [
    {
      type: 'summary_text',
      text: output.text,
    },
  ],
  encrypted_content: output.encryptedContent ?? null,
});

type OpenAIResponseOutputItem = OpenAIResponse['output'][number];

const toOutputItem = (
  output: CanonicalResponseOutput,
): OpenAIResponseOutputItem => {
  if (output.kind === 'message') {
    return toMessageOutputItem(output);
  }

  if (output.kind === 'tool_call') {
    return toToolCallOutputItem(output);
  }

  // web_search_call は non-tool 出力アイテム。Codex 本体はこれを TurnItem::WebSearch へマッピングする
  if (output.kind === 'web_search_call') {
    return toWebSearchCallOutputItem(output);
  }

  return toReasoningOutputItem(output);
};
// 各 to* 関数の戻り値は OpenAI Responses wire 形状の出力アイテム。
// toOutputItem が返す union を OpenAIResponse['output'][number] へ明示することで、
// 呼び出し側(toOpenAIResponse 内 .map)の型安全性を担保する

export const createInProgressOpenAIResponse = (
  request: CanonicalRequest,
): OpenAIResponse => ({
  id: request.id,
  object: 'response',
  created_at: Math.floor(Date.now() / 1000),
  status: 'in_progress',
  background: request.background,
  error: null,
  incomplete_details: null,
  instructions: request.instructions ?? null,
  max_output_tokens: request.maxOutputTokens ?? null,
  max_tool_calls: request.maxToolCalls ?? null,
  model: request.model,
  output: [],
  parallel_tool_calls: request.parallelToolCalls,
  previous_response_id: request.previousResponseId ?? null,
  reasoning: {
    effort: request.reasoning?.effort ?? null,
    summary: request.reasoning?.summary ?? null,
  },
  service_tier: request.serviceTier,
  store: request.store,
  temperature: request.temperature ?? null,
  text: request.text ?? {
    format: {
      type: 'text',
    },
  },
  tool_choice:
    request.toolChoice ?? (request.tools.length > 0 ? 'auto' : 'none'),
  tools: request.tools.map((tool) => tool.raw),
  top_p: request.topP ?? null,
  truncation: request.truncation,
  usage: null,
  user: null,
  metadata: request.metadata,
});

export const toOpenAIResponse = (
  request: CanonicalRequest,
  response: CanonicalResponse,
): OpenAIResponse => ({
  id: response.id,
  object: 'response',
  created_at: response.createdAt,
  completed_at: response.completedAt,
  status: response.status,
  background: response.background ?? request.background,
  error: response.error ?? null,
  incomplete_details: response.incompleteDetails ?? null,
  instructions: response.instructions ?? request.instructions ?? null,
  max_output_tokens:
    response.maxOutputTokens ?? request.maxOutputTokens ?? null,
  max_tool_calls: response.maxToolCalls ?? request.maxToolCalls ?? null,
  model: response.model,
  output: response.output.map((output: CanonicalResponseOutput) =>
    toOutputItem(output),
  ),
  parallel_tool_calls: response.parallelToolCalls,
  previous_response_id:
    response.previousResponseId ?? request.previousResponseId ?? null,
  reasoning: {
    effort: response.reasoning?.effort ?? request.reasoning?.effort ?? null,
    summary: response.reasoning?.summary ?? request.reasoning?.summary ?? null,
  },
  service_tier: response.serviceTier ?? request.serviceTier,
  store: response.store ?? request.store,
  temperature: response.temperature ?? request.temperature ?? null,
  text: request.text ?? {
    format: {
      type: 'text',
    },
  },
  tool_choice:
    response.toolChoice ??
    request.toolChoice ??
    (request.tools.length > 0 ? 'auto' : 'none'),
  tools:
    response.tools.length > 0
      ? response.tools.map((tool) => tool.raw)
      : request.tools.map((tool) => tool.raw),
  top_p: response.topP ?? request.topP ?? null,
  truncation: response.truncation,
  usage: toUsage(response),
  user: response.user ?? null,
  metadata: response.metadata,
});

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

export const createSyntheticAssistantMessageOutput = (text: string) => ({
  id: createMessageId(),
  type: 'message',
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


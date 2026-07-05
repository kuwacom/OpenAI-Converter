import type {
  CanonicalRequest,
  CanonicalResponse,
} from '@/models/canonical/response';
import type { CanonicalTool } from '@/models/canonical/tool';
import type {
  ChatCompletionMessage,
  ChatCompletionResponse,
} from '@/models/chatCompletionsModel';
import type { ChatCompletionRequestMapping } from '@/backends/chatCompletionsRequestMapper';
import {
  createCallId,
  createFunctionCallId,
  createMessageId,
  createReasoningId,
} from '@/lib/ids';
import { asObject } from '@/lib/object';
import { safeJsonParse } from '@/lib/jsonUtils';
import { extractCustomToolInput } from '@/lib/customToolInput';

type CanonicalOutput = CanonicalResponse['output'][number];

const getToolByName = (
  tools: readonly CanonicalTool[],
  name: string,
): CanonicalTool | undefined =>
  tools.find((tool) => tool.wireName === name || tool.name === name);


// 上流から構造化されたツール呼び出しを受け取った場合の正規化。
// function / custom / mcp / builtin 種別は wireName lookup 結果に従うことで、
// request-mapper のラッパー化された工具種別も元の形へ復元できる
const normalizeStructuredToolCall = (
  tools: readonly CanonicalTool[],
  rawToolCall: Record<string, unknown>,
): CanonicalOutput => {
  const rawFunction = asObject(rawToolCall.function);
  const candidateName =
    typeof rawFunction?.name === 'string'
      ? rawFunction.name
      : typeof rawToolCall.name === 'string'
        ? rawToolCall.name
        : 'unknown_tool';
  const tool = getToolByName(tools, candidateName);
  const rawArguments =
    typeof rawFunction?.arguments === 'string'
      ? rawFunction.arguments
      : typeof rawToolCall.arguments === 'string'
        ? (rawToolCall.arguments as string)
        : undefined;

  // Custom(Freeform)ツールでは {"input":"..."} 形式の JSON 文字列をそのまま保持すると
  // downstream の Codex apply_patch 検証が通らない。元テキスト(input 値)を取り出して格納する
  const isCustomTool = tool?.type === 'custom';

  return {
    kind: 'tool_call',
    id: createFunctionCallId(),
    status: 'completed',
    toolCall: {
      id: createFunctionCallId(),
      callId:
        typeof rawToolCall.id === 'string' ? rawToolCall.id : createCallId(),
      type: tool?.type ?? 'function',
      name: tool?.name ?? candidateName,
      wireName: tool?.wireName ?? candidateName,
      parentNamespace: tool?.parentNamespace,
      arguments: rawArguments
        ? isCustomTool
          ? extractCustomToolInput(rawArguments)
          : (safeJsonParse(rawArguments) ?? rawArguments)
        : undefined,
      // custom の場合、生引数(JSON文字列)ではなく抽出した input 本体を rawArguments へ格納し直す。
      // 出力変換(canonicalToResponse)で input フィールドを再構築する際に破綻しないようにするため
      rawArguments: isCustomTool && rawArguments
        ? extractCustomToolInput(rawArguments)
        : rawArguments,
      originalType: tool?.originalType ?? 'function_call',
      status: 'completed',
      raw: rawToolCall,
    },
  };
};

// 思考モデルは reasoning_content 文字列を返す。一部 provider は reasoning エイリアスを持つため両対応する
const extractReasoning = (
  message: ChatCompletionMessage | undefined,
): string => {
  if (!message) return '';
  if (typeof message.reasoning_content === 'string')
    return message.reasoning_content;
  if (typeof message.reasoning === 'string') return message.reasoning;
  return '';
};

// visible text を CC content(文字列 or parts 配列)から取り出す
const extractAssistantText = (
  message: ChatCompletionMessage | undefined,
): string => {
  if (!message) return '';
  const content = message.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => asObject(part))
      .filter((part): part is Record<string, unknown> => Boolean(part))
      .flatMap((part) => {
        if (typeof part.text === 'string') return [part.text];
        return [];
      })
      .join('');
  }
  return '';
};

const mapUsage = (
  response: ChatCompletionResponse,
): CanonicalResponse['usage'] | undefined => {
  if (!response.usage) return undefined;
  // Chat Completions usage 形状には reasoning_tokens 相当フィールドがないため未設定とする
  return {
    inputTokens: response.usage.prompt_tokens,
    outputTokens: response.usage.completion_tokens,
    totalTokens: response.usage.total_tokens,
  };
};

/**
 * ### mapChatCompletionToCanonicalResponse
 * 上流 Chat Completions 応答を canonical へ戻す。
 * 推論テキスト -> 構造化ツール呼び出し -> 可視テキスト回答、の順序で出力を組み立てる。
 */
export const mapChatCompletionToCanonicalResponse = (
  request: CanonicalRequest,
  _mapping: ChatCompletionRequestMapping,
  response: ChatCompletionResponse,
): CanonicalResponse => {
  const createdAt = response.created ?? Math.floor(Date.now() / 1000);
  const assistantMessage = response.choices[0]?.message;

  const structuredToolCalls: CanonicalOutput[] = Array.isArray(
    assistantMessage?.tool_calls,
  )
    ? assistantMessage!
        .tool_calls!.map((entry) => asObject(entry))
        .filter((value): value is Record<string, unknown> => Boolean(value))
        .map((raw) => normalizeStructuredToolCall(request.tools, raw))
    : [];

  const reasoningText = extractReasoning(assistantMessage);
  const visibleText = extractAssistantText(assistantMessage);

  const output: CanonicalOutput[] = [];

  if (reasoningText) {
    output.push({
      kind: 'reasoning',
      id: createReasoningId(),
      status: 'completed',
      text: reasoningText,
    });
  }

  output.push(...structuredToolCalls);

  if (visibleText) {
    output.push({
      kind: 'message',
      id: createMessageId(),
      status: 'completed',
      role: 'assistant',
      content: [{ type: 'text', text: visibleText }],
    });
  }

  return {
    id: request.id,
    object: 'response',
    createdAt,
    completedAt: Math.floor(Date.now() / 1000),
    status: 'completed',
    background: request.background,
    model: response.model ?? request.model,
    output,
    text: visibleText || undefined,
    reasoning: {
      effort: request.reasoning?.effort ?? null,
      summary: reasoningText || null,
    },
    usage: mapUsage(response),
    error: null,
    incompleteDetails: null,
    instructions: request.instructions ?? null,
    maxOutputTokens: request.maxOutputTokens ?? null,
    maxToolCalls: request.maxToolCalls ?? null,
    parallelToolCalls: request.parallelToolCalls,
    previousResponseId: request.previousResponseId ?? null,
    serviceTier: request.serviceTier,
    store: request.store,
    temperature: request.temperature ?? null,
    toolChoice: request.toolChoice,
    tools: request.tools,
    topP: request.topP ?? null,
    truncation: request.truncation ?? 'disabled',
    user: null,
    metadata: request.metadata ?? {},
    include: request.include ?? [],
    raw: { chatCompletion: response, backendResponseId: response.id },
  };
};



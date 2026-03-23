import { parseQwenResponseContent } from '@/adapters/chat-templates/qwen/parse';
import type { ParsedQwenToolCall } from '@/adapters/chat-templates/qwen/parse';
import type {
  CanonicalRequest,
  CanonicalResponse,
  CanonicalTool,
} from '@/models/canonical/response';
import type { LlamaCppChatCompletionResponse } from '@/models/llamacpp/chat-completions';
import {
  createFunctionCallId,
  createMessageId,
  createReasoningId,
  createCallId,
} from '@/utils/ids';
import { asObject, safeJsonParse, toJsonString } from '@/utils/json';
import type { LlamaCppQwenRequestMapping } from '@/backends/llamacpp/qwen/request-mapper';

const getToolByName = (
  toolMap: Map<string, CanonicalTool>,
  toolName: string,
): CanonicalTool | undefined => toolMap.get(toolName);

const normalizeStructuredToolCall = (
  toolMap: Map<string, CanonicalTool>,
  rawToolCall: Record<string, unknown>,
): CanonicalResponse['output'][number] => {
  const rawFunction = asObject(rawToolCall.function);
  const candidateName =
    typeof rawFunction?.name === 'string'
      ? rawFunction.name
      : typeof rawToolCall.name === 'string'
        ? rawToolCall.name
        : 'unknown_tool';
  const tool = getToolByName(toolMap, candidateName);
  const rawArguments =
    typeof rawFunction?.arguments === 'string'
      ? rawFunction.arguments
      : typeof rawToolCall.arguments === 'string'
        ? rawToolCall.arguments
        : undefined;

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
      arguments: rawArguments
        ? (safeJsonParse(rawArguments) ?? rawArguments)
        : undefined,
      rawArguments,
      originalType: tool?.originalType ?? 'function',
      status: 'completed',
      raw: rawToolCall,
    },
  };
};

const normalizeParsedToolCall = (
  toolMap: Map<string, CanonicalTool>,
  parsedToolCall: ParsedQwenToolCall,
): CanonicalResponse['output'][number] => {
  const tool = getToolByName(toolMap, parsedToolCall.name);

  return {
    kind: 'tool_call',
    id: createFunctionCallId(),
    status: 'completed',
    toolCall: {
      id: createFunctionCallId(),
      callId: createCallId(),
      type: tool?.type ?? 'unknown',
      name: tool?.name ?? parsedToolCall.name,
      wireName: tool?.wireName ?? parsedToolCall.name,
      arguments: parsedToolCall.arguments,
      rawArguments:
        parsedToolCall.rawArguments ??
        (typeof parsedToolCall.arguments === 'string'
          ? parsedToolCall.arguments
          : toJsonString(parsedToolCall.arguments, '{}')),
      originalType: tool?.originalType ?? 'unknown',
      status: 'completed',
      raw: parsedToolCall,
    },
  };
};

const getAssistantMessage = (response: LlamaCppChatCompletionResponse) =>
  response.choices[0]?.message;

export const mapLlamaCppChatCompletionToCanonicalResponse = (
  request: CanonicalRequest,
  mapping: LlamaCppQwenRequestMapping,
  response: LlamaCppChatCompletionResponse,
): CanonicalResponse => {
  const createdAt = response.created ?? Math.floor(Date.now() / 1000);
  const assistantMessage = getAssistantMessage(response);
  const assistantContent = assistantMessage?.content ?? '';
  const parsed = parseQwenResponseContent(assistantContent ?? '');
  const structuredToolCalls = Array.isArray(assistantMessage?.tool_calls)
    ? assistantMessage.tool_calls.map((toolCall) =>
        normalizeStructuredToolCall(mapping.toolMap, toolCall),
      )
    : [];
  const parsedToolCalls =
    structuredToolCalls.length > 0
      ? []
      : parsed.toolCalls.map((toolCall: ParsedQwenToolCall) =>
          normalizeParsedToolCall(mapping.toolMap, toolCall),
        );
  const output: CanonicalResponse['output'] = [];

  if (parsed.reasoningText) {
    output.push({
      kind: 'reasoning',
      id: createReasoningId(),
      status: 'completed',
      text: parsed.reasoningText,
    });
  }

  output.push(...structuredToolCalls, ...parsedToolCalls);

  if (parsed.text) {
    output.push({
      kind: 'message',
      id:
        typeof assistantMessage?.id === 'string'
          ? assistantMessage.id
          : createMessageId(),
      status: 'completed',
      role: 'assistant',
      content: [{ type: 'text', text: parsed.text }],
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
    text: parsed.text,
    reasoning: {
      effort: request.reasoning?.effort ?? null,
      summary: parsed.reasoningText ?? null,
    },
    usage: response.usage
      ? {
          inputTokens: response.usage.prompt_tokens,
          outputTokens: response.usage.completion_tokens,
          totalTokens: response.usage.total_tokens,
          reasoningTokens: request.reasoning?.effort ? 0 : 0,
        }
      : undefined,
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
    truncation: request.truncation,
    user: null,
    metadata: request.metadata,
    include: request.include,
    raw: {
      llamaCpp: response,
      backendResponseId: response.id,
      promptPreview: mapping.promptPreview,
      nativeToolMode: mapping.nativeToolMode,
    },
  };
};

import type {
  CanonicalRequest,
  CanonicalResponse,
} from '@/models/canonical/response';
import type { CanonicalContentPart } from '@/models/canonical/content';
import type { CanonicalTool } from '@/models/canonical/tool';
import type { OpenAIResponse } from '@/models/responsesModel';
import {
  createCallId,
  createFunctionCallId,
  createReasoningId,
} from '@/utils/ids';
import { safeJsonParse, toJsonString } from '@/utils/json';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const mapContentPart = (
  part: Record<string, unknown>,
): CanonicalContentPart[] => {
  if (part.type === 'output_text' && typeof part.text === 'string') {
    return [
      {
        type: 'text',
        text: part.text,
      },
    ];
  }

  return [
    {
      type: 'raw',
      raw: part,
    },
  ];
};

const isMessageItem = (
  value: OpenAIResponse['output'][number],
): value is Record<string, unknown> & {
  type: 'message';
  content: unknown[];
} => value.type === 'message' && Array.isArray(value.content);

const isReasoningItem = (
  value: OpenAIResponse['output'][number],
): value is Record<string, unknown> & {
  type: 'reasoning';
  summary?: unknown;
  encrypted_content?: unknown;
} => value.type === 'reasoning';

const getItemStatus = (item: Record<string, unknown>) =>
  typeof item.status === 'string' ? item.status : 'completed';

const getItemId = (
  item: Record<string, unknown>,
  fallback = createFunctionCallId(),
) => (typeof item.id === 'string' ? item.id : fallback);

const resolveTool = (
  tools: CanonicalTool[],
  name: string,
  itemType: string,
): CanonicalTool =>
  tools.find((tool) => tool.name === name || tool.wireName === name) ?? {
    id: createFunctionCallId(),
    type:
      itemType === 'mcp_call'
        ? 'mcp'
        : itemType === 'custom_tool_call'
          ? 'custom'
          : itemType === 'function_call'
            ? 'function'
            : 'builtin',
    name,
    wireName: name,
    originalType: itemType,
    raw: {
      type: itemType,
      name,
    },
  };

const getResponseText = (outputItems: OpenAIResponse['output']) =>
  outputItems
    .filter(isMessageItem)
    .flatMap((item) => item.content)
    .filter(
      (
        part,
      ): part is Record<string, unknown> & {
        type: 'output_text';
        text: string;
      } =>
        isRecord(part) &&
        part.type === 'output_text' &&
        typeof part.text === 'string',
    )
    .map((part) => part.text)
    .join('');

export const toCanonicalResponse = (
  request: CanonicalRequest,
  response: OpenAIResponse,
): CanonicalResponse => {
  const output: CanonicalResponse['output'] = [];

  for (const item of response.output) {
    if (isMessageItem(item)) {
      output.push({
        kind: 'message',
        id: getItemId(item, createFunctionCallId()),
        status: getItemStatus(item),
        role: 'assistant',
        content: item.content.flatMap((part) =>
          isRecord(part) ? mapContentPart(part) : [{ type: 'raw', raw: part }],
        ),
      });
      continue;
    }

    if (isReasoningItem(item)) {
      const firstSummary = Array.isArray(item.summary)
        ? item.summary[0]
        : undefined;

      output.push({
        kind: 'reasoning',
        id: getItemId(item, createReasoningId()),
        status: getItemStatus(item),
        text:
          firstSummary &&
          typeof firstSummary === 'object' &&
          firstSummary !== null &&
          'text' in firstSummary &&
          typeof firstSummary.text === 'string'
            ? firstSummary.text
            : '',
        encryptedContent:
          typeof item.encrypted_content === 'string'
            ? item.encrypted_content
            : undefined,
      });
      continue;
    }

    const itemName =
      typeof item.name === 'string'
        ? item.name
        : item.type.replace(/_call$/, '');
    const tool = resolveTool(request.tools, itemName, item.type);

    output.push({
      kind: 'tool_call',
      id: getItemId(item, createFunctionCallId()),
      status: getItemStatus(item),
      toolCall: {
        id: getItemId(item, createFunctionCallId()),
        callId:
          typeof item.call_id === 'string' ? item.call_id : createCallId(),
        type: tool.type,
        name: tool.name,
        wireName: tool.wireName,
        arguments:
          typeof item.arguments === 'string'
            ? (safeJsonParse(item.arguments) ?? item.arguments)
            : (item.arguments ?? item.input ?? null),
        rawArguments:
          typeof item.arguments === 'string'
            ? item.arguments
            : typeof item.input === 'string'
              ? item.input
              : typeof item.arguments === 'object'
                ? toJsonString(item.arguments, '{}')
                : undefined,
        originalType: tool.originalType ?? item.type,
        status: typeof item.status === 'string' ? item.status : 'completed',
        raw: item,
      },
    });
  }

  const responseText = getResponseText(response.output);

  return {
    id: response.id,
    object: 'response',
    createdAt: response.created_at,
    completedAt: response.completed_at,
    status: response.status,
    background: response.background ?? request.background,
    model: response.model,
    output,
    text: responseText || undefined,
    reasoning: response.reasoning
      ? {
          effort: response.reasoning.effort ?? undefined,
          summary:
            typeof response.reasoning.summary === 'string'
              ? response.reasoning.summary
              : undefined,
        }
      : undefined,
    error: response.error ?? null,
    incompleteDetails: response.incomplete_details ?? null,
    instructions: response.instructions ?? request.instructions ?? null,
    maxOutputTokens:
      response.max_output_tokens ?? request.maxOutputTokens ?? null,
    maxToolCalls: response.max_tool_calls ?? request.maxToolCalls ?? null,
    parallelToolCalls: response.parallel_tool_calls,
    previousResponseId:
      response.previous_response_id ?? request.previousResponseId ?? null,
    serviceTier: response.service_tier ?? request.serviceTier,
    store: response.store ?? request.store,
    temperature: response.temperature ?? request.temperature ?? null,
    toolChoice: request.toolChoice,
    tools: request.tools,
    topP: response.top_p ?? request.topP ?? null,
    truncation: response.truncation ?? request.truncation,
    user: response.user ?? null,
    metadata: response.metadata,
    include: request.include,
    usage: response.usage
      ? {
          inputTokens:
            typeof response.usage === 'object' &&
            response.usage !== null &&
            'input_tokens' in response.usage &&
            typeof response.usage.input_tokens === 'number'
              ? response.usage.input_tokens
              : undefined,
          outputTokens:
            typeof response.usage === 'object' &&
            response.usage !== null &&
            'output_tokens' in response.usage &&
            typeof response.usage.output_tokens === 'number'
              ? response.usage.output_tokens
              : undefined,
          totalTokens:
            typeof response.usage === 'object' &&
            response.usage !== null &&
            'total_tokens' in response.usage &&
            typeof response.usage.total_tokens === 'number'
              ? response.usage.total_tokens
              : undefined,
          reasoningTokens:
            typeof response.usage === 'object' &&
            response.usage !== null &&
            'output_tokens_details' in response.usage &&
            typeof response.usage.output_tokens_details === 'object' &&
            response.usage.output_tokens_details !== null &&
            'reasoning_tokens' in response.usage.output_tokens_details &&
            typeof response.usage.output_tokens_details.reasoning_tokens ===
              'number'
              ? response.usage.output_tokens_details.reasoning_tokens
              : undefined,
        }
      : undefined,
    raw: {
      upstream: response,
    },
  };
};

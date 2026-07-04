import type {
  CanonicalRequest,
  CanonicalResponse,
  CanonicalResponseOutput,
  CanonicalTool,
} from '@/models/canonical/response';
import type {
  CanonicalMessage,
  CanonicalToolCall,
} from '@/models/canonical/message';
import {
  createCallId,
  createFunctionCallId,
  createMessageId,
  createReasoningId,
} from '@/utils/ids';
import { asObject, safeJsonParse, toJsonString } from '@/utils/json';
import { DEFAULT_MAX_TOOL_CALLS } from '@/configs/config';

const TOOL_TAG_PATTERN = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi;
const THINK_TAG_PATTERN =
  /<(?:think|reasoning)>\s*([\s\S]*?)\s*<\/(?:think|reasoning)>/gi;

type ParsedToolCall = {
  name: string;
  arguments: unknown;
  rawArguments: string;
};

const extractTagContents = (content: string, pattern: RegExp) => {
  const results: string[] = [];
  const regex = new RegExp(pattern.source, pattern.flags);
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    results.push(match[1] ?? '');
  }

  return results;
};

const stripTags = (content: string, pattern: RegExp) =>
  content.replace(pattern, '').trim();

const findToolByName = (tools: CanonicalTool[], name: string) => {
  const normalized = name.trim();

  return tools.find((tool) =>
    [tool.name, tool.wireName, tool.originalType].some(
      (candidate) => typeof candidate === 'string' && candidate === normalized,
    ),
  );
};

const parseTaggedToolCalls = (content: string): ParsedToolCall[] =>
  extractTagContents(content, TOOL_TAG_PATTERN).map((chunk) => {
    const rawArguments = chunk.trim();
    const parsed = safeJsonParse<Record<string, unknown>>(rawArguments) ?? {};

    return {
      name: typeof parsed.name === 'string' ? parsed.name : 'unknown_tool',
      arguments:
        parsed && typeof parsed === 'object' && 'arguments' in parsed
          ? parsed.arguments
          : {},
      rawArguments,
    };
  });

const parseAssistantPayload = (content: string, tools: CanonicalTool[]) => {
  const parsedToolCalls = parseTaggedToolCalls(content);
  const reasoningText = extractTagContents(content, THINK_TAG_PATTERN)
    .join('\n\n')
    .trim();
  const visibleText = stripTags(
    stripTags(content, THINK_TAG_PATTERN),
    TOOL_TAG_PATTERN,
  );

  const toolCalls: CanonicalToolCall[] = parsedToolCalls.map((toolCall) => {
    const tool = findToolByName(tools, toolCall.name);

    return {
      id: createFunctionCallId(),
      callId: createCallId(),
      type: tool?.type ?? 'function',
      name: tool?.name ?? toolCall.name,
      wireName: tool?.wireName ?? toolCall.name,
      arguments: toolCall.arguments,
      rawArguments: toolCall.rawArguments,
      originalType: tool?.originalType ?? 'function',
      status: 'completed',
      raw: toolCall,
    };
  });

  return {
    visibleText,
    reasoningText,
    toolCalls,
  };
};

const buildOutputs = (
  content: string,
  tools: CanonicalTool[],
): CanonicalResponseOutput[] => {
  const parsed = parseAssistantPayload(content, tools);
  const output: CanonicalResponseOutput[] = [];

  if (parsed.reasoningText) {
    output.push({
      kind: 'reasoning',
      id: createReasoningId(),
      status: 'completed',
      text: parsed.reasoningText,
    });
  }

  output.push(
    ...parsed.toolCalls.map((toolCall) => ({
      kind: 'tool_call' as const,
      id: createFunctionCallId(),
      status: 'completed',
      toolCall,
    })),
  );

  if (parsed.visibleText) {
    output.push({
      kind: 'message',
      id: createMessageId(),
      status: 'completed',
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: parsed.visibleText,
        },
      ],
    });
  }

  return output;
};

const extractResponseText = (response: CanonicalResponse) => {
  if (typeof response.text === 'string' && response.text.length > 0) {
    return response.text;
  }

  const textFromOutput = response.output
    .filter(
      (item): item is Extract<CanonicalResponseOutput, { kind: 'message' }> =>
        item.kind === 'message',
    )
    .flatMap((item) => item.content)
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n');

  if (textFromOutput) {
    return textFromOutput;
  }

  const raw = asObject(response.raw);
  return typeof raw?.text === 'string' ? raw.text : '';
};

const toAssistantToolCallMessage = (
  toolCalls: CanonicalToolCall[],
): CanonicalMessage => ({
  id: createMessageId(),
  role: 'assistant',
  content: [],
  toolCalls,
});

const toToolResultMessage = (
  toolCall: CanonicalToolCall,
): CanonicalMessage => ({
  id: createMessageId(),
  role: 'tool',
  toolCallId: toolCall.callId,
  content: [
    {
      type: 'text',
      text:
        typeof toolCall.rawArguments === 'string'
          ? toolCall.rawArguments
          : typeof toolCall.arguments === 'string'
            ? toolCall.arguments
            : toJsonString(toolCall.arguments, '{}'),
    },
  ],
});

export const synthesizeCanonicalResponseOutputs = (
  response: CanonicalResponse,
  tools: CanonicalTool[],
): CanonicalResponse => {
  if (response.output.length > 0) {
    return response;
  }

  const text = extractResponseText(response);
  if (!text) {
    return response;
  }

  const parsed = parseAssistantPayload(text, tools);

  return {
    ...response,
    text: parsed.visibleText,
    output: buildOutputs(text, tools),
    reasoning:
      parsed.reasoningText || response.reasoning
        ? {
            ...response.reasoning,
            summary:
              parsed.reasoningText || response.reasoning?.summary || null,
          }
        : response.reasoning,
  };
};

export const executeToolLoop = async ({
  request,
  initialResponse,
  executeTurn,
}: {
  request: CanonicalRequest;
  initialResponse: CanonicalResponse;
  executeTurn: (request: CanonicalRequest) => Promise<CanonicalResponse>;
}): Promise<CanonicalResponse> => {
  let response = synthesizeCanonicalResponseOutputs(
    initialResponse,
    request.tools,
  );
  let messages = [...request.messages];
  let totalToolCalls = 0;
  const maxToolCalls = request.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS;

  while (true) {
    const toolCalls = response.output
      .filter(
        (
          item,
        ): item is Extract<CanonicalResponseOutput, { kind: 'tool_call' }> =>
          item.kind === 'tool_call',
      )
      .map((item) => item.toolCall);

    if (toolCalls.length === 0) {
      return response;
    }

    totalToolCalls += toolCalls.length;
    if (totalToolCalls > maxToolCalls) {
      return {
        ...response,
        incompleteDetails: {
          reason: 'max_tool_calls_exceeded',
        },
      };
    }

    messages = [
      ...messages,
      toAssistantToolCallMessage(toolCalls),
      ...toolCalls.map((toolCall) => toToolResultMessage(toolCall)),
    ];

    response = synthesizeCanonicalResponseOutputs(
      await executeTurn({
        ...request,
        messages,
        stream: false,
      }),
      request.tools,
    );
  }
};

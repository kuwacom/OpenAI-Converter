import type {
  CanonicalRequest,
  CanonicalTool,
} from '@/models/canonical/response';
import type {
  LlamaCppChatCompletionMessage,
  LlamaCppChatCompletionRequest,
} from '@/models/llamacpp/chat-completions';
import { renderQwenChatTemplate } from '@/adapters/chat-templates/qwen/render';
import { asObject, toJsonString } from '@/utils/json';

export type LlamaCppQwenRequestMapping = {
  request: LlamaCppChatCompletionRequest;
  promptPreview: string;
  toolMap: Map<string, CanonicalTool>;
  nativeToolMode: boolean;
};

const buildNativeMessages = (
  request: CanonicalRequest,
): LlamaCppChatCompletionMessage[] => {
  const systemMessages = request.messages.filter(
    (message) => message.role === 'system' || message.role === 'developer',
  );
  const systemText = systemMessages
    .flatMap((message) =>
      message.content
        .filter((part) => part.type === 'text')
        .map((part) => part.text),
    )
    .join('\n\n')
    .trim();

  const messages: LlamaCppChatCompletionMessage[] = [];

  if (systemText) {
    messages.push({
      role: 'system',
      content: systemText,
    });
  }

  for (const message of request.messages) {
    if (message.role === 'system' || message.role === 'developer') {
      continue;
    }

    const text = message.content
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('\n')
      .trim();

    if (message.role === 'assistant') {
      messages.push({
        role: 'assistant',
        content: text || null,
        tool_calls: message.toolCalls?.map((toolCall) => ({
          id: toolCall.callId,
          type: 'function',
          function: {
            name: toolCall.name,
            arguments:
              toolCall.rawArguments ?? toJsonString(toolCall.arguments, '{}'),
          },
        })),
      });
      continue;
    }

    if (message.role === 'tool') {
      messages.push({
        role: 'tool',
        content: text,
        tool_call_id: message.toolCallId,
      });
      continue;
    }

    messages.push({
      role: message.role,
      content: text,
    });
  }

  return messages;
};

const canUseNativeToolMode = (request: CanonicalRequest) =>
  request.tools.every((tool) => tool.type === 'function');

const mapNativeTools = (request: CanonicalRequest) =>
  request.tools
    .filter((tool) => tool.type === 'function')
    .map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters ?? {
          type: 'object',
          properties: {},
        },
        strict: tool.strict ?? true,
      },
    }));

const mapResponseFormat = (
  request: CanonicalRequest,
): Record<string, unknown> | undefined => {
  const format = request.text?.format;

  if (!format || typeof format !== 'object' || Array.isArray(format)) {
    return undefined;
  }

  return asObject(format);
};

export const mapCanonicalRequestToLlamaCppQwenRequest = (
  request: CanonicalRequest,
  backendModel?: string,
): LlamaCppQwenRequestMapping => {
  const toolMap = new Map(request.tools.map((tool) => [tool.wireName, tool]));
  const nativeToolMode = canUseNativeToolMode(request);
  const rendered = renderQwenChatTemplate(request, !nativeToolMode);
  const nativeMessages = buildNativeMessages(request);

  return {
    request: {
      model: backendModel ?? request.model,
      messages: nativeToolMode ? nativeMessages : rendered.messages,
      tools: nativeToolMode ? mapNativeTools(request) : undefined,
      tool_choice: nativeToolMode ? request.toolChoice : undefined,
      parallel_tool_calls: request.parallelToolCalls,
      stream: request.stream,
      temperature: request.temperature,
      top_p: request.topP,
      max_tokens: request.maxOutputTokens,
      response_format: mapResponseFormat(request),
    },
    promptPreview: rendered.promptPreview,
    toolMap,
    nativeToolMode,
  };
};

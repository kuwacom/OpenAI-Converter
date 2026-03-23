import type { CanonicalContentPart } from '@/models/canonical/content';
import type { CanonicalMessage } from '@/models/canonical/message';
import type { CanonicalRequest } from '@/models/canonical/response';
import type { LlamaCppChatCompletionMessage } from '@/models/llamacpp/chat-completions';
import { toJsonString } from '@/utils/json';
import {
  buildQwenToolSystemPrompt,
  renderQwenToolResponse,
} from '@/adapters/chat-templates/qwen/tools';

const getTextContent = (message: CanonicalMessage) =>
  message.content
    .filter(
      (
        part: CanonicalContentPart,
      ): part is Extract<CanonicalContentPart, { type: 'text' }> =>
        part.type === 'text',
    )
    .map((part) => part.text)
    .join('\n')
    .trim();

const getReasoningContent = (message: CanonicalMessage) =>
  message.content
    .filter(
      (
        part: CanonicalContentPart,
      ): part is Extract<CanonicalContentPart, { type: 'reasoning' }> =>
        part.type === 'reasoning',
    )
    .map((part) => part.text)
    .join('\n')
    .trim();

const renderAssistantMessage = (message: CanonicalMessage) => {
  const reasoning = getReasoningContent(message);
  const textContent = getTextContent(message);
  const chunks: string[] = [];

  if (reasoning) {
    chunks.push(`<think>\n${reasoning}\n</think>`);
  }

  if (message.toolCalls?.length) {
    for (const toolCall of message.toolCalls) {
      chunks.push(
        `<tool_call>\n${JSON.stringify(
          {
            name: toolCall.wireName,
            arguments: toolCall.arguments ?? toolCall.rawArguments ?? {},
          },
          null,
          2,
        )}\n</tool_call>`,
      );
    }
  }

  if (textContent) {
    chunks.push(textContent);
  }

  return chunks.join('\n\n').trim();
};

const renderUserLikeContent = (message: CanonicalMessage) => {
  const textContent = getTextContent(message);

  if (textContent) {
    return textContent;
  }

  return message.content
    .map(
      (part: CanonicalContentPart) =>
        `[${part.type}] ${toJsonString(part, '')}`,
    )
    .join('\n');
};

const combineSystemMessages = (
  request: CanonicalRequest,
  includeToolInstructions: boolean,
) => {
  const systemMessages = request.messages.filter(
    (message) => message.role === 'system' || message.role === 'developer',
  );

  const body = systemMessages
    .map((message) => renderUserLikeContent(message))
    .filter(Boolean);

  if (includeToolInstructions && request.tools.length > 0) {
    body.push(buildQwenToolSystemPrompt(request, request.tools));
  }

  return body.join('\n\n').trim();
};

const toQwenChatMessages = (
  request: CanonicalRequest,
  includeToolInstructions: boolean,
): LlamaCppChatCompletionMessage[] => {
  const systemContent = combineSystemMessages(request, includeToolInstructions);
  const messages: LlamaCppChatCompletionMessage[] = [];

  if (systemContent) {
    messages.push({
      role: 'system',
      content: systemContent,
    });
  }

  for (const message of request.messages) {
    if (message.role === 'system' || message.role === 'developer') {
      continue;
    }

    if (message.role === 'assistant') {
      messages.push({
        role: 'assistant',
        content: renderAssistantMessage(message),
      });
      continue;
    }

    if (message.role === 'tool') {
      messages.push({
        role: 'user',
        content: renderQwenToolResponse(renderUserLikeContent(message)),
      });
      continue;
    }

    messages.push({
      role: message.role,
      content: renderUserLikeContent(message),
    });
  }

  return messages;
};

const renderPromptPreview = (messages: LlamaCppChatCompletionMessage[]) =>
  `${messages
    .map(
      (message) =>
        `<|im_start|>${message.role}\n${message.content ?? ''}\n<|im_end|>`,
    )
    .join('\n')}\n<|im_start|>assistant\n`;

export const renderQwenChatTemplate = (
  request: CanonicalRequest,
  includeToolInstructions: boolean,
) => {
  const messages = toQwenChatMessages(request, includeToolInstructions);

  return {
    messages,
    promptPreview: renderPromptPreview(messages),
  };
};

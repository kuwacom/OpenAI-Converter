import type {
  LlamaCppChatCompletionRequest,
  LlamaCppChatCompletionResponse,
} from '@/models/llamacpp/chat-completions';
import { LlamaCppChatCompletionResponseSchema } from '@/schemas/llamacpp/chat-completions';
import { HttpError } from '@/types/errors';

type CreateChatCompletionParams = {
  baseUrl: string;
  body: LlamaCppChatCompletionRequest;
  signal?: AbortSignal;
};

export const createChatCompletion = async ({
  baseUrl,
  body,
  signal,
}: CreateChatCompletionParams): Promise<Response> => {
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    throw new HttpError(response.status, 'llama.cpp request failed', {
      body: await response.text(),
      status: response.status,
    });
  }

  return response;
};

export const parseChatCompletion = async (
  response: Response,
): Promise<LlamaCppChatCompletionResponse> =>
  LlamaCppChatCompletionResponseSchema.parse(await response.json());

export async function* parseChatCompletionStream(response: Response) {
  if (!response.body) {
    throw new HttpError(502, 'llama.cpp stream did not return a body');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() ?? '';

    for (const chunk of chunks) {
      const dataLines = chunk
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim());

      for (const dataLine of dataLines) {
        if (!dataLine || dataLine === '[DONE]') {
          continue;
        }

        yield JSON.parse(dataLine) as LlamaCppChatCompletionResponse;
      }
    }
  }
}

import {
  ResponseSchema,
  ResponseStreamEventSchema,
} from '@/schemas/openai/responses';
import { HttpError } from '@/types/errors';

type CreateResponseParams = {
  baseUrl: string;
  body: Record<string, unknown>;
  signal?: AbortSignal;
};

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

export const createResponse = async ({
  baseUrl,
  body,
  signal,
}: CreateResponseParams): Promise<Response> => {
  const response = await fetch(`${trimTrailingSlash(baseUrl)}/v1/responses`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    throw new HttpError(
      response.status,
      'openai-compatible response request failed',
      {
        body: await response.text(),
        status: response.status,
      },
    );
  }

  return response;
};

export const parseResponse = async (response: Response) =>
  ResponseSchema.parse(await response.json());

export async function* parseResponseStream(response: Response) {
  if (!response.body) {
    throw new HttpError(502, 'openai-compatible stream did not return a body');
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

        yield ResponseStreamEventSchema.parse(JSON.parse(dataLine));
      }
    }
  }
}

import {
  ResponseSchema,
  ResponseStreamEventSchema,
} from '@/schemas/responsesSchema';
import { readSseDataLines } from '@/lib/sseStream';
import { HttpError } from '@/types/errors';

type CreateResponseParams = {
  baseUrl: string;
  body: Record<string, unknown>;
  signal?: AbortSignal;
  apiKey?: string;
};

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

// 認証ヘッダは環境変数経由で注入するためハードコードしない
const buildHeaders = (contentType: string, apiKey?: string): HeadersInit => {
  const headers: Record<string, string> = { 'content-type': contentType };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  return headers;
};

/**
 * ### createResponse
 * 上流 responses エンドポイントへ非ストリーミング要求を送る(native backend 用)
 *
 * @returns fetch Response
 */
export const createResponse = async ({
  baseUrl,
  body,
  signal,
  apiKey,
}: CreateResponseParams): Promise<Response> => {
  const url = `${trimTrailingSlash(baseUrl)}/responses`;
  const response = await fetch(url, {
    method: 'POST',
    headers: buildHeaders('application/json', apiKey),
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    throw new HttpError(
      response.status,
      'openai-compatible-responses request failed',
      { body: await response.text(), status: response.status },
    );
  }

  return response;
};

/** ### parseResponse */
export const parseResponse = async (response: Response) =>
  ResponseSchema.parse(await response.json());

/**
 * ### parseResponseStream
 * Responses SSE ストリームをイベント単位で yield する generator
 */
export async function* parseResponseStream(response: Response) {
  if (!response.body) {
    throw new HttpError(502, 'openai-compatible stream did not return a body');
  }

  for await (const dataLine of readSseDataLines(response)) {
    if (!dataLine || dataLine === '[DONE]') continue;
    yield ResponseStreamEventSchema.parse(JSON.parse(dataLine));
  }
}

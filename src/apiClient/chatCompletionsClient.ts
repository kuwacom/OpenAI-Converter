import { ChatCompletionResponseSchema } from '@/schemas/chatCompletionsSchema';
import type { ChatCompletionRequest } from '@/models/chatCompletionsModel';
import { HttpError } from '@/types/errors';

type UpstreamAuthContext = { apiKey?: string };

// URL を正規化して結合するだけのユーティリティ
const joinUrl = (baseUrl: string, suffix: string) =>
  `${baseUrl.replace(/\/+$/, '')}${suffix}`;

// 認証ヘッダは環境変数経由で注入するためハードコードしない
const buildHeaders = (
  contentType: string,
  auth?: UpstreamAuthContext,
): HeadersInit => {
  const headers: Record<string, string> = { 'content-type': contentType };
  if (auth?.apiKey) headers.authorization = `Bearer ${auth.apiKey}`;
  return headers;
};

type CreateChatCompletionParams = {
  baseUrl: string;
  body: ChatCompletionRequest;
  signal?: AbortSignal;
} & UpstreamAuthContext;

/**
 * ### createChatCompletion
 * 上流へ Chat Completions 非ストリーミング要求を送る
 *
 * @param params.baseUrl - 上流ベースURL(`/v1` 含む前提)
 * @param params.body    - 変換済み Chat Completions リクエストボディ
 * @returns fetch Response
 */
export const createChatCompletion = async ({
  baseUrl,
  body,
  signal,
  apiKey,
}: CreateChatCompletionParams): Promise<Response> => {
  const response = await fetch(joinUrl(baseUrl, '/chat/completions'), {
    method: 'POST',
    headers: buildHeaders('application/json', apiKey ? { apiKey } : undefined),
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    throw new HttpError(response.status, 'chat-completion request failed', {
      body: await response.text(),
      status: response.status,
      url: joinUrl(baseUrl, '/chat/completions'),
    });
  }

  return response;
};

/**
 * ### parseChatCompletion
 */
export const parseChatCompletion = async (response: Response) =>
  ChatCompletionResponseSchema.parse(await response.json());

/**
 * ### parseChatCompletionStream
 * SSE チャンクを読み出す async generator
 */
export async function* parseChatCompletionStream(response: Response) {
  if (!response.body) {
    throw new HttpError(502, 'chat-completion stream did not return a body');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() ?? '';

    for (const chunk of chunks) {
      const dataLines = chunk
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim());

      for (const dataLine of dataLines) {
        if (!dataLine || dataLine === '[DONE]') continue;
        yield ChatCompletionResponseSchema.parse(JSON.parse(dataLine));
      }
    }
  }
}

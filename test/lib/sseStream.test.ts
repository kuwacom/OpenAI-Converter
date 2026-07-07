import { describe, expect, it } from 'vitest';
import { readSseDataLines } from '@/lib/sseStream';

const responseFromChunks = (chunks: string[]) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    }),
  );

const collectSseData = async (response: Response) => {
  const data: string[] = [];
  for await (const line of readSseDataLines(response)) {
    data.push(line);
  }
  return data;
};

describe('readSseDataLines', () => {
  it('yields a final data event even without a trailing blank line', async () => {
    await expect(
      collectSseData(responseFromChunks(['data: {"ok":true}'])),
    ).resolves.toEqual(['{"ok":true}']);
  });

  it('handles CRLF-framed events split across chunks', async () => {
    await expect(
      collectSseData(
        responseFromChunks(['event: delta\r\ndata: {"a":', '1}\r\n\r\n']),
      ),
    ).resolves.toEqual(['{"a":1}']);
  });

  it('joins multiple data lines in the same SSE event', async () => {
    await expect(
      collectSseData(responseFromChunks(['data: {"a":\ndata: 1}\n\n'])),
    ).resolves.toEqual(['{"a":\n1}']);
  });
});

const EVENT_SEPARATOR = /\r\n\r\n|\n\n|\r\r/;

const readDataPayload = (chunk: string): string | undefined => {
  const dataLines = chunk
    .split(/\r\n|\n|\r/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim());

  return dataLines.length > 0 ? dataLines.join('\n') : undefined;
};

export async function* readSseDataLines(
  response: Response,
): AsyncGenerator<string> {
  if (!response.body) {
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        buffer += decoder.decode();
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split(EVENT_SEPARATOR);
      buffer = chunks.pop() ?? '';

      for (const chunk of chunks) {
        const dataPayload = readDataPayload(chunk);
        if (dataPayload !== undefined) {
          yield dataPayload;
        }
      }
    }

    if (buffer) {
      const dataPayload = readDataPayload(buffer);
      if (dataPayload !== undefined) {
        yield dataPayload;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

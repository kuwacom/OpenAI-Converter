/**
 * ### readSseDataLines
 * fetch Response の SSE body を読み出し、各 event の data 行文字列を yield する。
 *
 * OpenAI 互換 API(chat completions / responses 双方)の SSE は
 *   - 複数 event は空行(\n\n)で区切られる
 *   - 各 event 内の "data:" 行が JSON ペイロード([DONE] センチネル含む)を運ぶ
 * という共通形状のため、両 apiClient から利用する。
 *
 * @param response - fetch Response。body 必須
 * @yields 各 data 行の内容(data: プレフィックス除去済み)。"[DONE]" 含む
 */
export async function* readSseDataLines(
  response: Response,
): AsyncGenerator<string> {
  if (!response.body) {
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    // SSE event 区切り(空行)ごとに分割。末尾の未完断片は buffer へ戻す
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() ?? '';

    for (const chunk of chunks) {
      // data: で始まる行だけを抽出する(event:/id:/retry 等は無視)
      for (const dataLine of chunk
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())) {
        yield dataLine;
      }
    }
  }
}

import type {
  WebSearchActionSource,
  WebSearchCallPayload,
  WebSearchSourceRecord,
  WebSearchSourceRegistry,
} from '@/types/webSearch';

/**
 * ### createWebSearchSourceRegistry
 * source ID 付きの参照管理マップを生成する(Map<S${n}, record>)
 */
export const createWebSearchSourceRegistry = (): WebSearchSourceRegistry =>
  new Map<string, WebSearchSourceRecord>();

/**
 * ### registerSource
 * URL 重複を避けつつ source を登録する。既存同一 URL があればそれを返し ID 採番を進めない
 */
export const registerSource = (
  registry: WebSearchSourceRegistry,
  candidate: Omit<WebSearchSourceRecord, 'id'>,
): WebSearchSourceRecord => {
  for (const source of registry.values()) {
    if (source.url === candidate.url) return source;
  }

  const record: WebSearchSourceRecord = {
    ...candidate,
    id: `S${registry.size + 1}`,
  };

  registry.set(record.id, record);
  return record;
};

/**
 * ### buildActionSources
 * source 配列を action.sources 形式へ変換する
 */
export const buildActionSources = (
  sources: readonly WebSearchSourceRecord[],
): WebSearchActionSource[] =>
  sources.map((source) => ({
    type: 'url',
    source_id: source.id,
    url: source.url,
    title: source.title,
  }));

/**
 * ### renderSearchOutput
 * モデルへ渡す web_search 出力テキストを組み立てる。
 *
 * `<web_search_output action="...">` タグ形式でソース一覧を提示し、モデルが [S1] 等のマーカーで引用できるよう誘導する
 */
export const renderSearchOutput = (
  payload: WebSearchCallPayload,
  sources: readonly WebSearchSourceRecord[],
): string => {
  const lines = [
    `<web_search_output action="${payload.action}">`,
    payload.query ? `Query: ${payload.query}` : null,
    payload.url ? `URL: ${payload.url}` : null,
    'Use only the sources below for web-grounded claims. Cite them inline with markers like [S1].',
    '',
  ].filter((line): line is string => Boolean(line));

  if (sources.length === 0) {
    lines.push('No sources were found.');
  } else {
    for (const source of sources) {
      lines.push(`[${source.id}] ${source.title}`);
      lines.push(`URL: ${source.url}`);
      if (source.siteName) lines.push(`Site: ${source.siteName}`);
      if (source.snippet) lines.push(`Snippet: ${source.snippet}`);
      if (source.excerpt) lines.push(`Extracted text: ${source.excerpt}`);
      lines.push('');
    }
  }

  lines.push('</web_search_output>');
  return lines.join('\n');
};

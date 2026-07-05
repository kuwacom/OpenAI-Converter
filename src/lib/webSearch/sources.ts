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

/**
 * ### buildAnnotatedWebSearchText
 * モデル最終回答テキスト内の引用マーカー([S1]/URL)から url_citation annotations を生成する。
 *
 * 優先順位:
 * 1. [S1],[S2] 形式マーカー → registry 参照で url_citation 抽出
 * 2. 本文に直接 URL 出現 → 該当 source の url_citation 付与
 * 3. 上位いずれも無い場合、末尾へ Sources 行を自動付与してマーカー再抽出(フォールバック)
 *
 * @param text モデルが生成した最終回答本文
 * @param registry web_search 実行で蓄積した source 群
 * @returns annotations 付き整形済み text と url_citation 配列
 */
export const buildAnnotatedWebSearchText = (
  text: string,
  registry: WebSearchSourceRegistry,
): { text: string; annotations: UrlCitationAnnotation[] } => {
  let finalText = text;
  let annotations = collectMarkerAnnotations(finalText, registry);

  if (annotations.length === 0) {
    annotations = collectUrlAnnotations(finalText, registry);
  }

  // フォールバック: source 存在だが本文中引用マーカー/URL 共に無い場合、
  // 末尾へ Sources 行を付与して再度マーカー抽出を行う(最低限の参照可能性担保)
  if (annotations.length === 0 && registry.size > 0) {
    const footer = Array.from(registry.values())
      .slice(0, 3)
      .map((source) => `[${source.id}] ${source.title}`)
      .join('; ');

    finalText = `${finalText.trimEnd()}\n\nSources: ${footer}`;
    annotations = collectMarkerAnnotations(finalText, registry);
  }

  return { text: finalText, annotations };
};

// url_citation annotation の TypeScript 表現。schemas/contentSchema.ts UrlCitationAnnotationSchema と整合
export type UrlCitationAnnotation = {
  type: 'url_citation';
  start_index: number;
  end_index: number;
  url: string;
  title?: string;
};

/**
 * ### collectMarkerAnnotations
 * 本文中の [S1],[S2] 形式マーカーを抽出し registry 参照で url_citation annotations を生成する
 */
const collectMarkerAnnotations = (
  text: string,
  registry: WebSearchSourceRegistry,
): UrlCitationAnnotation[] => {
  const annotations: UrlCitationAnnotation[] = [];
  const markerRegex = /\[(S\d+(?:\s*,\s*S\d+)*)\]/g;
  let match: RegExpExecArray | null;

  while ((match = markerRegex.exec(text)) !== null) {
    const ids = (match[1] ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);

    for (const id of ids) {
      const source = registry.get(id);
      if (!source) continue;
      annotations.push({
        type: 'url_citation',
        start_index: match.index,
        end_index: match.index + match[0].length,
        url: source.url,
        title: source.title,
      });
    }
  }

  return annotations;
};

/**
 * ### collectUrlAnnotations
 * 本文中に source URL が直接出現した場合の url_citation annotation 抽出(マーカー未使用時フォールバック)
 */
const collectUrlAnnotations = (
  text: string,
  registry: WebSearchSourceRegistry,
): UrlCitationAnnotation[] => {
  const annotations: UrlCitationAnnotation[] = [];

  for (const source of registry.values()) {
    const index = text.indexOf(source.url);
    if (index === -1) continue;
    annotations.push({
      type: 'url_citation',
      start_index: index,
      end_index: index + source.url.length,
      url: source.url,
      title: source.title,
    });
  }

  return annotations;
};

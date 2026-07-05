import logger from '@/services/logger';
import {
  buildAcceptLanguage,
  collapseWhitespace,
  decodeHtmlEntities,
  ensureTrailingSlash,
  trimToNull,
} from '@/lib/webSearch/core';
import type { WebSearchConfig } from '@/types/env';
import type {
  WebSearchCallPayload,
  WebSearchToolConfig,
  WebSearchUserLocation,
} from '@/types/webSearch';

interface SearxResult {
  url: string;
  title: string;
  snippet: string;
  siteName: string | null;
}

export interface FetchPageResult {
  url: string;
  title: string;
  text: string;
  excerpt: string;
}

/** SearXNG / env 既定位置情報を参照するための実行パラメータ束 */
export interface WebSearchParamsBase {
  config: WebSearchConfig;
}

/**
 * ### buildLocationHint
 * 位置情報ヒントを検索語に足せる文字列へ整形する
 */
const buildLocationHint = (
  userLocation: WebSearchUserLocation | null,
): string => {
  if (!userLocation) return '';

  const parts = [userLocation.city, userLocation.region, userLocation.country]
    .filter(
      (part): part is string =>
        typeof part === 'string' && part.trim().length > 0,
    )
    .map((part) => part.trim());

  return parts.join(' ');
};

/**
 * ### buildSearchQuery
 * 検索 payload と設定から最終検索語を組み立てる。
 *
 * リクエスト起点の位置情報のみ検索語へ補強し env 既定値混入を避ける(検索品質劣化防止のため)
 */
export const buildSearchQuery = (
  payload: WebSearchCallPayload,
  config: WebSearchToolConfig,
): string | null => {
  const baseQuery = payload.query ?? payload.queries?.[0] ?? null;
  if (!baseQuery) return null;

  if (config.userLocationSource !== 'request') {
    return baseQuery;
  }

  const locationHint = buildLocationHint(config.userLocation);
  if (!locationHint) return baseQuery;
  if (baseQuery.toLowerCase().includes(locationHint.toLowerCase())) {
    return baseQuery;
  }
  return `${baseQuery} ${locationHint}`;
};

const pickContentRoot = (html: string): string => {
  const mainMatch = html.match(/<(main|article)\b[^>]*>([\s\S]*?)<\/\1>/i);
  if (mainMatch?.[2]) return mainMatch[2];

  const bodyMatch = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch?.[1]) return bodyMatch[1];

  return html;
};

const extractTitle = (html: string): string => {
  const metaMatch =
    html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i) ??
    html.match(/<meta\s+name="twitter:title"\s+content="([^"]+)"/i);
  if (metaMatch?.[1]) return collapseWhitespace(decodeHtmlEntities(metaMatch[1]));

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch?.[1]) return collapseWhitespace(decodeHtmlEntities(titleMatch[1]));

  return '';
};

/**
 * ### extractReadablePage
 * HTML からタイトルと可読テキストを抽出する
 */
export const extractReadablePage = (
  html: string,
  fallbackUrl: string,
  extractCharLimit: number,
): { title: string; text: string } => {
  const contentRoot = pickContentRoot(html)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|iframe)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(
      /<\/(p|div|section|article|main|li|ul|ol|table|tr|td|h1|h2|h3|h4|h5|h6)>/gi,
      '\n',
    )
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<[^>]+>/g, ' ');

  const text = collapseWhitespace(decodeHtmlEntities(contentRoot)).slice(
    0,
    extractCharLimit,
  );

  // title 抽出失敗時は URL ホスト名をフォールバックに用いる(可読性のため)
  const fallbackTitle = (() => {
    try {
      return new URL(fallbackUrl).hostname;
    } catch {
      return fallbackUrl;
    }
  })();

  return {
    title: extractTitle(html) || fallbackTitle,
    text,
  };
};

/**
 * ### excerptAround
 * 検索語周辺の抜粋テキストを切り出す
 */
export const excerptAround = (text: string, needle: string): string => {
  if (!text) return '';
  if (!needle) return text.slice(0, 600);

  const index = text.toLowerCase().indexOf(needle.toLowerCase());
  if (index === -1) return text.slice(0, 600);

  const start = Math.max(0, index - 220);
  const end = Math.min(text.length, index + needle.length + 220);
  return text.slice(start, end).trim();
};

/**
 * ### findInPageExcerpts
 * ページ内検索結果の抜粋を複数件返す(最大5件)
 */
export const findInPageExcerpts = (
  text: string,
  needle: string,
): string[] => {
  if (!text || !needle) return [];

  const results: string[] = [];
  const lowerText = text.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  let fromIndex = 0;

  while (results.length < 5) {
    const index = lowerText.indexOf(lowerNeedle, fromIndex);
    if (index === -1) break;
    const start = Math.max(0, index - 180);
    const end = Math.min(text.length, index + lowerNeedle.length + 180);
    results.push(text.slice(start, end).trim());
    fromIndex = index + lowerNeedle.length;
  }

  return results;
};

/**
 * ### createTimedAbortSignal
 * 指定ミリ秒で自動 abort するシグナルを生成し親シグナルも連動させる。
 *
 * cleanup を呼ぶとタイマー除去と listener 解放を行うため必ず finally 経由で解放すること
 */
const createTimedAbortSignal = (
  timeoutMs: number,
  parentSignal?: AbortSignal,
): { signal: AbortSignal; cleanup: () => void } => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const abortListener = () => controller.abort();
  parentSignal?.addEventListener('abort', abortListener);

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout);
      parentSignal?.removeEventListener('abort', abortListener);
    },
  };
};

const concatChunks = (chunks: Uint8Array[], size: number): Uint8Array => {
  const merged = new Uint8Array(size);
  let offset = 0;

  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }

  return merged;
};

/**
 * ### readResponseText
 * レスポンスボディを最大バイト数で打ち切って文字列化する。
 *
 * content-length ヘッダー事前判定とストリーム読み途中の上限カット両方で過大ページを防ぐ
 */
const readResponseText = async (
  response: Response,
  maxBytes: number,
): Promise<string> => {
  const contentLength = Number(
    response.headers.get('content-length') ?? Number.NaN,
  );
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error(
      `response exceeds max byte limit (${contentLength} > ${maxBytes})`,
    );
  }

  if (!response.body) return response.text();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      const remaining = maxBytes - received;
      if (remaining <= 0) {
        await reader.cancel();
        break;
      }

      const nextChunk =
        value.length > remaining ? value.slice(0, remaining) : value;
      chunks.push(nextChunk);
      received += nextChunk.length;

      if (value.length > remaining) {
        await reader.cancel();
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }

  return new TextDecoder('utf-8').decode(concatChunks(chunks, received));
};

/**
 * ### fetchPage
 * URL を取得して可読ページ情報へ変換する。
 *
 * 不正な content-type や取得失敗時は null を返し呼出側はフォールバックテキスト表示へ回す
 */
export const fetchPage = async (
  url: string,
  params: WebSearchParamsBase,
  signal?: AbortSignal,
): Promise<FetchPageResult | null> => {
  const { config } = params;
  const { signal: timedSignal, cleanup } = createTimedAbortSignal(
    config.fetchTimeoutMs,
    signal,
  );

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1',
        'User-Agent': config.userAgent,
      },
      redirect: 'follow',
      signal: timedSignal,
    });

    if (!response.ok) {
      logger.warn(`[web_search] page fetch failed ${response.status} for ${url}`);
      return null;
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (
      contentType &&
      !/text\/html|application\/xhtml\+xml|text\/plain|application\/xml|text\/xml/i.test(
        contentType,
      )
    ) {
      logger.debug(
        `[web_search] skipping unsupported content-type ${contentType} for ${url}`,
      );
      return null;
    }

    // レスポンスサイズは上限で打ち切って極端に大きいページを避ける
    const body = await readResponseText(response, config.fetchMaxBytes);
    const page = extractReadablePage(body, url, config.extractCharLimit);
    if (!page.text) return null;

    return {
      url,
      title: page.title,
      text: page.text,
      excerpt: page.text.slice(0, 900),
    };
  } catch (error) {
    logger.warn(`[web_search] page fetch error for ${url}: ${String(error)}`);
    return null;
  } finally {
    cleanup();
  }
};

/**
 * ### resolveSearxSearchUrl
 * SearXNG 検索 URL を組み立てる。queryUrl テンプレート優先、未指定時は baseUrl/search へフォールバックする。
 *
 * `<query>` プレースホルダ使用時は URL エンコードして埋め込む。format=json と language を必ず付与する
 */
const resolveSearxSearchUrl = ({
  query,
  config,
}: {
  query: string;
  config: WebSearchConfig;
}): URL => {
  const normalizedQueryUrlTemplate = trimToNull(config.searxngQueryUrl);

  if (normalizedQueryUrlTemplate) {
    try {
      const usesPlaceholder =
        normalizedQueryUrlTemplate.includes('<query>');
      const rawUrl = usesPlaceholder
        ? normalizedQueryUrlTemplate.replaceAll(
            '<query>',
            encodeURIComponent(query),
          )
        : normalizedQueryUrlTemplate;
      const url = new URL(rawUrl);

      if (!usesPlaceholder) {
        url.searchParams.set('q', query);
      }

      url.searchParams.set('format', 'json');
      if (!url.searchParams.has('language')) {
        url.searchParams.set('language', config.language);
      }

      return url;
    } catch (error) {
      logger.warn(
        `[web_search] invalid searxng query url template: ${String(error)}`,
      );
    }
  }

  const url = new URL('search', ensureTrailingSlash(config.searxngBaseUrl));
  url.searchParams.set('format', 'json');
  url.searchParams.set('q', query);
  url.searchParams.set('language', config.language);
  return url;
};

/**
 * ### querySearx
 * SearXNG へ問い合わせて検索結果を取得する。
 *
 * 失敗時は例外を投げず呼出側でフォールバックテキスト表示へ回せるよう空配列を返す設計も検討したが、
 * execute 層でステータス区別(無効 vs 一時エラー)可能とするため HTTP 異常系は throw する
 */
export const querySearx = async (
  query: string,
  params: WebSearchParamsBase,
  signal?: AbortSignal,
): Promise<SearxResult[]> => {
  const { config } = params;

  // searxngBaseUrl/queryUrl 共に未設定時は検索実行不可能。呼出側で stub へ回す前提だが念のため空配列を返す
  if (!config.searxngBaseUrl && !config.searxngQueryUrl) {
    return [];
  }

  const url = resolveSearxSearchUrl({ query, config });

  const { signal: timedSignal, cleanup } = createTimedAbortSignal(
    config.timeoutMs,
    signal,
  );

  try {
    const response = await fetch(url.toString(), {
      headers: {
        Accept: 'application/json',
        'Accept-Language': buildAcceptLanguage(config.language),
        'User-Agent': config.userAgent,
        ...(config.clientIp ? { 'X-Real-IP': config.clientIp } : {}),
      },
      signal: timedSignal,
    });

    if (!response.ok) {
      throw new Error(`searxng request failed with ${response.status}`);
    }

    const payload = await response.json();
    const rawResults = Array.isArray(payload?.results)
      ? payload.results
      : [];

    return rawResults
      .map((item: Record<string, unknown>) => {
        const resultUrl =
          typeof item.url === 'string' ? item.url : '';
        if (!resultUrl) return null;

        const parsedUrlArr = Array.isArray(item.parsed_url)
          ? item.parsed_url
          : undefined;

        return {
          url: resultUrl,
          title:
            typeof item.title === 'string' && item.title.trim().length > 0
              ? item.title.trim()
              : resultUrl,
          snippet:
            typeof item.content === 'string'
              ? collapseWhitespace(item.content)
              : typeof item.snippet === 'string'
                ? collapseWhitespace(item.snippet)
                : '',
          siteName:
            typeof item.engine === 'string'
              ? item.engine
              : Array.isArray(parsedUrlArr) &&
                  parsedUrlArr.length > 1 &&
                  typeof parsedUrlArr[1] === 'string'
                ? (parsedUrlArr[1] ?? '')
                : null,
        };
      })
      .filter((item: SearxResult | null): item is SearxResult => Boolean(item));
  } finally {
    cleanup();
  }
};

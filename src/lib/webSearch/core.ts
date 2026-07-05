import { WEB_SEARCH_MAX_LIMIT } from '@/configs/constants';
import type { WebSearchConfig } from '@/types/env';
import type {
  WebSearchActionType,
  WebSearchCallPayload,
  WebSearchToolConfig,
  WebSearchUserLocation,
} from '@/types/webSearch';

/** search_context_size ごとの検索件数上限 */
export const buildSearchContextLimits = (defaultLimit: number) =>
  ({
    low: 3,
    medium: defaultLimit,
    high: WEB_SEARCH_MAX_LIMIT,
  }) as const satisfies Record<WebSearchToolConfig['searchContextSize'], number>;

/** search_context_size ごとのページ取得件数上限 */
export const buildSearchContextFetchPages = (fetchMaxPagesPerCall: number) =>
  ({
    low: 1,
    medium: Math.min(3, fetchMaxPagesPerCall),
    high: fetchMaxPagesPerCall,
  }) as const satisfies Record<WebSearchToolConfig['searchContextSize'], number>;

const HTML_ENTITY_MAP: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
};

/** tool type 表記を比較しやすい snake_case へ正規化する */
const normalizeToolTypeTokens = (type: unknown): string => {
  if (typeof type !== 'string') return '';

  return type
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
};

/** 受領値が web_search 系譜の built-in 宣言種別か否か */
export const isWebSearchToolType = (type: unknown): boolean => {
  const normalized = normalizeToolTypeTokens(type);
  if (!normalized) return false;

  return (
    normalized === 'web_search' ||
    normalized === 'web_search_preview' ||
    normalized.startsWith('web_search_preview_') ||
    normalized.startsWith('web_search_')
  );
};

const normalizeWebSearchAction = (
  value: unknown,
): WebSearchActionType | null => {
  const normalized = normalizeToolTypeTokens(value);
  if (!normalized) return null;

  if (
    normalized === 'open_page' ||
    normalized.endsWith('_open_page') ||
    normalized.includes('_open_page_')
  ) {
    return 'open_page';
  }

  if (
    normalized === 'find_in_page' ||
    normalized.endsWith('_find_in_page') ||
    normalized.includes('_find_in_page_')
  ) {
    return 'find_in_page';
  }

  if (
    normalized === 'search' ||
    normalized.endsWith('_search') ||
    normalized.includes('_search_') ||
    isWebSearchToolType(value)
  ) {
    return 'search';
  }

  return null;
};

/**
 * ### clamp
 * 数値を範囲内へ丸め込む
 *
 * @param value 対象値
 * @param min 下限
 * @param max 上限
 * @returns 範囲内に収まった値
 */
export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** URL 連結しやすいよう末尾スラッシュを補う */
export const ensureTrailingSlash = (value: string): string =>
  value.endsWith('/') ? value : `${value}/`;

/** 空文字を null 扱いへ寄せる */
export const trimToNull = (
  value: string | null | undefined,
): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

/** HTML エンティティを通常文字へ戻す */
export const decodeHtmlEntities = (value: string): string =>
  value
    .replace(/&(amp|lt|gt|quot|nbsp|#39);/g, (match) => HTML_ENTITY_MAP[match] ?? match)
    .replace(/&#(\d+);/g, (_match, code) =>
      String.fromCodePoint(Number.parseInt(code, 10)),
    )
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    );

/** 余分な空白や改行を潰して読みやすくする */
export const collapseWhitespace = (value: string): string =>
  value
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const normalizeDomain = (value: string): string => {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return '';

  try {
    const parsed = new URL(
      trimmed.includes('://') ? trimmed : `https://${trimmed}`,
    );
    return parsed.hostname.replace(/^\.+/, '');
  } catch {
    return trimmed
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split('/')[0] ?? ''
      .trim();
  }
};

/**
 * ### isDomainAllowed
 * 許可ドメインリストに対象 URL のホスト名が合致するか判定する。
 *
 * 空配列時は全許可扱いとする(既定動作)
 */
export const isDomainAllowed = (
  url: string,
  allowedDomains: string[],
): boolean => {
  if (allowedDomains.length === 0) return true;

  try {
    const host = new URL(url).hostname.toLowerCase();
    return allowedDomains.some(
      (domain) => host === domain || host.endsWith(`.${domain}`),
    );
  } catch {
    return false;
  }
};

const pickSearchContextSize = (
  value: unknown,
): WebSearchToolConfig['searchContextSize'] => {
  if (value === 'low' || value === 'medium' || value === 'high') return value;
  return 'medium';
};

/**
 * ### resolveDefaultUserLocationFromConfig
 * AppConfig.webSearch 由来既定ユーザ位置情報を組み立てる。全項目空なら null を返す
 */
export const resolveDefaultUserLocationFromConfig = (
  cfg: Pick<
    WebSearchConfig,
    | 'defaultUserLocationType'
    | 'defaultUserLocationCity'
    | 'defaultUserLocationRegion'
    | 'defaultUserLocationCountry'
    | 'defaultUserLocationTimezone'
  >,
): WebSearchUserLocation | null => {
  const type = trimToNull(cfg.defaultUserLocationType);
  const city = trimToNull(cfg.defaultUserLocationCity);
  const region = trimToNull(cfg.defaultUserLocationRegion);
  const country = trimToNull(cfg.defaultUserLocationCountry);
  const timezone = trimToNull(cfg.defaultUserLocationTimezone);

  if (!type && !city && !region && !country && !timezone) {
    return null;
  }

  return {
    ...(type ? { type } : {}),
    ...(city ? { city } : {}),
    ...(region ? { region } : {}),
    ...(country ? { country } : {}),
    ...(timezone ? { timezone } : {}),
  };
};

/**
 * ### buildAcceptLanguage
 * Accept-Language ヘッダーを自然な優先度付きで組み立てる
 */
export const buildAcceptLanguage = (language: string): string => {
  const trimmed = language.trim();
  if (!trimmed) return 'ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7';

  const primary = trimmed.split(',')[0]?.trim() ?? trimmed;
  const base = primary.split('-')[0]?.trim();

  if (!base || base.toLowerCase() === primary.toLowerCase()) {
    return `${primary},en-US;q=0.8,en;q=0.7`;
  }

  return `${primary},${base};q=0.9,en-US;q=0.8,en;q=0.7`;
};

// request.tools 配列の各エントリは未知形状確率があるため Record<string,unknown> 入力とする。
// BLACKBOX 由来だが env 集約方式のため any 受領は廃止した
type RawToolEntry = Record<string, unknown>;

/**
 * ### normalizeAllowedDomains
 * リクエスト side filters/domains 配列から許可ドメイン群を正規化する
 */
const normalizeAllowedDomains = (tool: RawToolEntry): string[] => {
  const filtersRaw =
    typeof tool.filters === 'object' && tool.filters != null
      ? (tool.filters as RawToolEntry)
      : undefined;
  const candidates: unknown[] = Array.isArray(tool.domains)
    ? tool.domains
    : Array.isArray(tool.filters)
      ? tool.filters
      : Array.isArray(filtersRaw?.domains)
        ? (filtersRaw.domains as unknown[])
        : Array.isArray(filtersRaw?.allowed_domains)
          ? (filtersRaw.allowed_domains as unknown[])
          : [];

  const normalizedDomains = candidates
    .filter((value): value is string => typeof value === 'string')
    .map(normalizeDomain)
    .filter((value): value is string => Boolean(value));

  return Array.from(new Set(normalizedDomains)).slice(0, 100);
};

/**
 * ### normalizeWebSearchToolConfig
 * request.tools 配列から web_search 宣言を見つけ動作設定を抽出する。
 *
 * 本 proxy 設計方針B(上流プロンプト注入誘導)の中核入力となる。
 * 未指定時 search_context_size 既定 medium 採用
 */
export const normalizeWebSearchToolConfig = (
  tools: readonly unknown[],
): WebSearchToolConfig | null => {
  if (!Array.isArray(tools)) return null;

  const rawTool = tools.find((entry): entry is RawToolEntry => {
    if (typeof entry === 'string') return false;
    if (entry && typeof entry === 'object') {
      return isWebSearchToolType((entry as RawToolEntry).type);
    }
    return false;
  });

  if (!rawTool) return null;

  // rawTool.type 文字列を保持。preview 系譜も含めてそのまま記録し upstream 注入時に参照する
  const rawToolType =
    typeof rawTool.type === 'string' && rawTool.type.length > 0
      ? rawTool.type
      : null;

  // user_location 起点(env 既定 vs リクエスト明示)。env 既定値解決は execute 層へ委ねるためここでは request 明示のみ保持
  const requestedUserLocationRaw =
    typeof rawTool.user_location === 'object' && rawTool.user_location != null
      ? (rawTool.user_location as RawToolEntry)
      : null;
  const requestedUserLocation: WebSearchUserLocation | null =
    requestedUserLocationRaw
      ? {
          ...(typeof requestedUserLocationRaw.type === 'string'
            ? { type: requestedUserLocationRaw.type }
            : {}),
          ...(typeof requestedUserLocationRaw.city === 'string'
            ? { city: requestedUserLocationRaw.city }
            : {}),
          ...(typeof requestedUserLocationRaw.region === 'string'
            ? { region: requestedUserLocationRaw.region }
            : {}),
          ...(typeof requestedUserLocationRaw.country === 'string'
            ? { country: requestedUserLocationRaw.country }
            : {}),
          ...(typeof requestedUserLocationRaw.timezone === 'string'
            ? { timezone: requestedUserLocationRaw.timezone }
            : {}),
        }
      : null;

  return {
    rawToolType,
    searchContextSize: pickSearchContextSize(rawTool.search_context_size),
    externalWebAccess:
      typeof rawTool.external_web_access === 'boolean'
        ? rawTool.external_web_access
        : true,
    allowedDomains: normalizeAllowedDomains(rawTool),
    userLocation: requestedUserLocation,
    userLocationSource: requestedUserLocation ? 'request' : null,
  };
};

/**
 * ### normalizeWebSearchCallPayload
 * model 出力 function_call 引数(JSON 文字列想定)を実行可能 payload 形へ正規化する。
 *
 * action/query/url の各表現揺らぎや存在位置違いを吸収し execute 層簡素化を図る
 *
 * @param value 受領引数(parsed object/string 混在容認)
 * @returns action 判定済み payload(action 解決不能時は "search" 既定)
 */
export const normalizeWebSearchCallPayload = (
  value: unknown,
): WebSearchCallPayload => {
  const obj =
    typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)
      : {};
  const actionRaw =
    typeof obj.action === 'object' && obj.action !== null
      ? (obj.action as Record<string, unknown>)
      : undefined;
  const action =
    normalizeWebSearchAction(actionRaw?.type) ??
    normalizeWebSearchAction(obj.action) ??
    normalizeWebSearchAction(obj.type) ??
    'search';

  const query =
    typeof obj.query === 'string'
      ? obj.query
      : typeof actionRaw?.query === 'string'
        ? actionRaw.query
        : Array.isArray(obj.queries)
          ? (obj.queries.find((item: unknown): item is string => typeof item === 'string') ?? null)
          : Array.isArray(actionRaw?.queries)
            ? (actionRaw.queries.find((item: unknown): item is string => typeof item === 'string') ?? null)
            : null;

  const queries = Array.isArray(obj.queries)
    ? obj.queries.filter((item: unknown): item is string => typeof item === 'string')
    : Array.isArray(actionRaw?.queries)
      ? actionRaw.queries.filter((item: unknown): item is string => typeof item === 'string')
      : query
        ? [query]
        : null;

  const url =
    typeof obj.url === 'string'
      ? obj.url
      : typeof actionRaw?.url === 'string'
        ? actionRaw.url
        : null;

  return {
    action,
    query,
    queries,
    url,
  };
};

export type LogLevel =
  | 'silly'
  | 'trace'
  | 'debug'
  | 'info'
  | 'warn'
  | 'error'
  | 'fatal';

/** env 由来 web_search 実行パラメータ群 */
export type WebSearchConfig = {
  // SearXNG API エンドポイント基底。空文字時は無効化扱い(stub fallback)
  searxngBaseUrl: string;
  // `<query>` プレースホルダ使用可能な検索 URL テンプレート(任意)
  searxngQueryUrl: string;
  language: string;
  clientIp: string;
  userAgent: string;
  defaultLimit: number;
  maxLimit: number;
  fetchMaxPagesPerCall: number;
  timeoutMs: number;
  fetchTimeoutMs: number;
  fetchMaxBytes: number;
  extractCharLimit: number;
  defaultUserLocationType: string;
  defaultUserLocationCity: string;
  defaultUserLocationRegion: string;
  defaultUserLocationCountry: string;
  defaultUserLocationTimezone: string;
};

// Cloudflare Workers の bindings 形式。
// Node 実行では process.env を同一キーで扱うため、両環境で getAppConfig を共通化できる
export type AppBindings = {
  HOST?: string;
  PORT?: string;
  CORS_ORIGIN?: string;
  WEB_SEARCH_SEARXNG_BASE_URL?: string;
  WEB_SEARCH_SEARXNG_QUERY_URL?: string;
  WEB_SEARCH_SEARXNG_LANGUAGE?: string;
  WEB_SEARCH_SEARXNG_CLIENT_IP?: string;
  WEB_SEARCH_USER_AGENT?: string;
  WEB_SEARCH_DEFAULT_LIMIT?: string;
  WEB_SEARCH_MAX_LIMIT?: string;
  WEB_SEARCH_FETCH_MAX_PAGES_PER_CALL?: string;
  WEB_SEARCH_TIMEOUT_MS?: string;
  WEB_SEARCH_FETCH_TIMEOUT_MS?: string;
  WEB_SEARCH_FETCH_MAX_BYTES?: string;
  WEB_SEARCH_EXTRACT_CHAR_LIMIT?: string;
  // env 既定ユーザ位置情報群
  WEB_SEARCH_DEFAULT_USER_LOCATION_TYPE?: string;
  WEB_SEARCH_DEFAULT_USER_LOCATION_CITY?: string;
  WEB_SEARCH_DEFAULT_USER_LOCATION_REGION?: string;
  WEB_SEARCH_DEFAULT_USER_LOCATION_COUNTRY?: string;
  WEB_SEARCH_DEFAULT_USER_LOCATION_TIMEZONE?: string;
  UPSTREAM_BASE_URL?: string;
  UPSTREAM_MODEL?: string;
  UPSTREAM_API_KEY?: string;
  DEFAULT_BACKEND?: string;
  LOG_LEVEL?: string;
};

// Hono の generic に渡す環境型
export type AppEnv = {
  Bindings: AppBindings;
};

// 全ての backend は単一の上流 OpenAI 互換エンドポイントへ向かう。
// API キーはハードコードせず環境変数から注入する(AppConfig.upstreamApiKey)
export type AppConfig = {
  host: string;
  port: number;
  corsOrigin: string;

  // ビルトイン web_search(SearXNG)実行パラメータ群。
  // baseUrl 空文字時は機能無効扱いとしリクエスト側は stub fallback へ寄せる
  webSearch: WebSearchConfig;
  upstreamBaseUrl: string;
  upstreamModel: string;
  upstreamApiKey: string;
  defaultBackend: string;
  logLevel: LogLevel;
};

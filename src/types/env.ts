export type LogLevel =
  | 'silly'
  | 'trace'
  | 'debug'
  | 'info'
  | 'warn'
  | 'error'
  | 'fatal';

// Cloudflare Workers の bindings 形式。
// Node 実行では process.env を同一キーで扱うため、両環境で getAppConfig を共通化できる
export type AppBindings = {
  HOST?: string;
  PORT?: string;
  CORS_ORIGIN?: string;
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
  upstreamBaseUrl: string;
  upstreamModel: string;
  upstreamApiKey: string;
  defaultBackend: string;
  logLevel: LogLevel;
};

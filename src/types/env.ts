export type LogLevel =
  | 'silly'
  | 'trace'
  | 'debug'
  | 'info'
  | 'warn'
  | 'error'
  | 'fatal';

// Cloudflare Workers の bindings 形式
// Node 実行では process.env を同一キーで扱うため、両環境で getAppConfig を共通化できる
export type AppBindings = {
  HOST?: string;
  PORT?: string;
  CORS_ORIGIN?: string;
  LLAMACPP_BASE_URL?: string;
  LLAMACPP_MODEL?: string;
  OPENAI_COMPATIBLE_BASE_URL?: string;
  OPENAI_COMPATIBLE_MODEL?: string;
  DEFAULT_BACKEND?: string;
  LOG_LEVEL?: string;
};

// Hono の generic に渡す環境型
export type AppEnv = {
  Bindings: AppBindings;
};

export type AppConfig = {
  host: string;
  port: number;
  corsOrigin: string;
  llamaCppBaseUrl: string;
  llamaCppModel: string;
  openAICompatibleBaseUrl?: string;
  openAICompatibleModel: string;
  defaultBackend: string;
  logLevel: LogLevel;
};

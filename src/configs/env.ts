import {
  EnvSchema,
  resolveUpstreamApiKey,
  resolveUpstreamBaseUrl,
  resolveUpstreamModel,
  type EnvShape,
} from '@/schemas/envSchema';
import type { AppConfig, AppBindings } from '@/types/env';

// Workers では process が未定義のため、ここでは process.env に依存しない
// Node の .env 読み込みは node.ts の import 'dotenv/config' に委ねる
const getProcessEnv = (): NodeJS.ProcessEnv | undefined => {
  if (typeof process === 'undefined') return undefined;
  return process.env;
};

// Node では process.env 起動後に不変なため初回パース結果をキャッシュする
// Workers では bindings がリクエストごとに異なり得るためキャッシュせず都度パースする
let nodeConfigCache: AppConfig | undefined;

const resolveInput = (bindings?: AppBindings) =>
  ({
    ...(getProcessEnv() ?? {}),
    ...(bindings ?? {}),
  }) as Record<string, string | undefined>;

/**
 * ### getAppConfig
 * Node/Workers 双方の環境入力を統合し AppConfig を構築する唯一の関数
 */
export const getAppConfig = (bindings?: AppBindings): AppConfig => {
  if (!bindings && nodeConfigCache) return nodeConfigCache;

  const parsed: EnvShape = EnvSchema.parse(resolveInput(bindings));

  const config: AppConfig = {
    host: parsed.HOST,
    port: parsed.PORT,
    corsOrigin: parsed.CORS_ORIGIN,
    upstreamBaseUrl: resolveUpstreamBaseUrl(parsed.UPSTREAM_BASE_URL),
    upstreamModel: resolveUpstreamModel(parsed.UPSTREAM_MODEL),
    upstreamApiKey: resolveUpstreamApiKey(parsed.UPSTREAM_API_KEY),
    defaultBackend: parsed.DEFAULT_BACKEND,
    logLevel: parsed.LOG_LEVEL,
  };

  if (!bindings) nodeConfigCache = config;
  return config;
};

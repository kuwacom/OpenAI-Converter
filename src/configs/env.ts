import { EnvSchema, type EnvShape } from '@/schemas/config/env';
import type { AppConfig, AppBindings } from '@/types/env';

// Workers では process が未定義のため、ここでは process.env に依存しない
// Node の .env 読み込みは node.ts の import 'dotenv/config' に委ねる
const getProcessEnv = (): NodeJS.ProcessEnv | undefined => {
  if (typeof process === 'undefined') {
    return undefined;
  }

  return process.env;
};

// Node では process.env 起動後に不変なため初回パース結果をキャッシュする
// Workers では bindings がリクエストごとに異なり得るためキャッシュせず都度パースする
let nodeConfigCache: AppConfig | undefined;

const resolveInput = (bindings?: AppBindings) => {
  const processEnv = getProcessEnv();

  return {
    ...(processEnv ?? {}),
    ...(bindings ?? {}),
  } as Record<string, string | undefined>;
};

export const getAppConfig = (bindings?: AppBindings): AppConfig => {
  if (!bindings && nodeConfigCache) {
    return nodeConfigCache;
  }

  const parsed: EnvShape = EnvSchema.parse(resolveInput(bindings));

  const config: AppConfig = {
    host: parsed.HOST,
    port: parsed.PORT,
    corsOrigin: parsed.CORS_ORIGIN,
    llamaCppBaseUrl: parsed.LLAMACPP_BASE_URL,
    llamaCppModel: parsed.LLAMACPP_MODEL,
    openAICompatibleBaseUrl: parsed.OPENAI_COMPATIBLE_BASE_URL,
    openAICompatibleModel: parsed.OPENAI_COMPATIBLE_MODEL,
    defaultBackend: parsed.DEFAULT_BACKEND,
    logLevel: parsed.LOG_LEVEL,
  };

  if (!bindings) {
    nodeConfigCache = config;
  }

  return config;
};

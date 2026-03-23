import { config as loadEnv } from 'dotenv';
import { EnvSchema, type EnvShape } from '@/schemas/config/env';
import type { AppConfig } from '@/types/env';

loadEnv();

let cachedConfig: AppConfig | undefined;

export const getAppConfig = (): AppConfig => {
  if (cachedConfig) {
    return cachedConfig;
  }

  const parsed: EnvShape = EnvSchema.parse(process.env);

  cachedConfig = {
    appName: parsed.APP_NAME,
    port: parsed.PORT,
    llamaCppBaseUrl: parsed.LLAMACPP_BASE_URL,
    llamaCppModel: parsed.LLAMACPP_MODEL,
    openAICompatibleBaseUrl: parsed.OPENAI_COMPATIBLE_BASE_URL,
    openAICompatibleModel: parsed.OPENAI_COMPATIBLE_MODEL,
    defaultBackend: parsed.DEFAULT_BACKEND,
    logLevel: parsed.LOG_LEVEL,
  };

  return cachedConfig;
};

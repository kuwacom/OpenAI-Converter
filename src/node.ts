import { serve } from '@hono/node-server';
import app from '@/app';
import { getAppConfig } from '@/configs/env';
import { serverLogger } from '@/services/logger';

const config = getAppConfig();

serverLogger.debug('Resolved app config', {
  appName: config.appName,
  port: config.port,
  defaultBackend: config.defaultBackend,
  logLevel: config.logLevel,
  llamaCppBaseUrl: config.llamaCppBaseUrl,
  llamaCppModel: config.llamaCppModel,
  openAICompatibleBaseUrl: config.openAICompatibleBaseUrl,
  openAICompatibleModel: config.openAICompatibleModel,
});

serve(
  {
    fetch: app.fetch,
    port: config.port,
  },
  (info) => {
    serverLogger.info('Server started', info);
  },
);

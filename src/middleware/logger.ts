import { createMiddleware } from 'hono/factory';
import { httpLogger } from '@/services/logger';
import type { AppEnv } from '@/types/env';

export const loggerMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const startedAt = Date.now();

  await next();

  const durationMs = Date.now() - startedAt;
  const status = c.res.status;
  const logPayload = {
    status,
    durationMs,
    path: c.req.path,
    userAgent: c.req.header('user-agent') ?? 'unknown',
  };

  if (status >= 500) {
    httpLogger.error(`${c.req.method} ${c.req.path}`, logPayload);
    return;
  }

  if (status >= 400) {
    httpLogger.warn(`${c.req.method} ${c.req.path}`, logPayload);
    return;
  }

  httpLogger.info(`${c.req.method} ${c.req.path}`, logPayload);
});

import type { MiddlewareHandler } from 'hono';
import { httpLogger } from '@/services/logger';

export const loggerMiddleware: MiddlewareHandler = async (c, next) => {
  const startedAt = Date.now();
  const requestDetails = {
    method: c.req.method,
    path: c.req.path,
    query: c.req.query(),
  };

  httpLogger.info('Request received', requestDetails);
  httpLogger.debug('Request details', {
    ...requestDetails,
    headers: Object.fromEntries(c.req.raw.headers.entries()),
  });

  await next();

  const completionDetails = {
    ...requestDetails,
    durationMs: Date.now() - startedAt,
    status: c.res.status,
  };

  if (c.res.status >= 500) {
    httpLogger.error('Request completed', completionDetails);
    return;
  }

  if (c.res.status >= 400) {
    httpLogger.warn('Request completed', completionDetails);
    return;
  }

  httpLogger.info('Request completed', completionDetails);
};

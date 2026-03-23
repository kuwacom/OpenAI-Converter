import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { handleError } from '@/middleware/error-handler';
import { loggerMiddleware } from '@/middleware/logger';
import router from '@/routes';
import { serverLogger } from '@/services/logger';

export const createApp = () => {
  const app = new Hono();

  app.use('*', cors());
  app.use('*', loggerMiddleware);
  app.route('/', router);

  app.notFound((c) =>
    c.json({ error: { type: 'not_found', message: 'Not found' } }, 404),
  );

  app.onError((error, c) => {
    try {
      serverLogger.error('Unhandled application error', error);
    } catch (loggerError) {
      console.error(
        '[logger-fallback] failed to log application error',
        loggerError,
      );
    }

    return handleError(error, c);
  });

  return app;
};

const app = createApp();

export default app;

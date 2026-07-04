import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { getAppConfig } from '@/configs/env';
import { errorHandler } from '@/middleware/errorHandler';
import { loggerMiddleware } from '@/middleware/logger';
import router from '@/routes';
import type { AppEnv } from '@/types/env';

export const createApp = () => {
  const app = new Hono<AppEnv>();

  // CORS の origin はリクエストの bindings から解決する
  // Workers と Node で共通化するため getAppConfig(c.env) 経由にする
  app.use('*', (c, next) => {
    const middleware = cors({
      origin: getAppConfig(c.env).corsOrigin,
    });

    return middleware(c, next);
  });

  app.use('*', loggerMiddleware);

  app.route('/', router);

  // 未定義 route は routes/fallback で処理するため app.notFound は置かない
  app.onError((error, c) => errorHandler(error, c));

  return app;
};

const app = createApp();

export default app;

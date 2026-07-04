import { Hono } from 'hono';
import { fallback } from '@/routes/v1/fallback';
import healthRouter from '@/routes/v1/health';
import responsesRouter from '@/routes/v1/responses';
import type { AppEnv } from '@/types/env';

const v1Router = new Hono<AppEnv>();

v1Router.route('/health', healthRouter);
v1Router.route('/responses', responsesRouter);
// /v1 配下の未定義 route を 404 として扱う
v1Router.all('*', fallback);

export default v1Router;

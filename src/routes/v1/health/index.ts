import { Hono } from 'hono';
import { getAppConfig } from '@/configs/env';

const healthRouter = new Hono();

healthRouter.get('/', (c) =>
  c.json({
    status: 'ok',
    backend: getAppConfig().defaultBackend,
  }),
);

export default healthRouter;

import { Hono } from 'hono';
import { get } from './get';
import type { AppEnv } from '@/types/env';

const healthRouter = new Hono<AppEnv>();

healthRouter.get('/', get);

export default healthRouter;

import { Hono } from 'hono';
import { cancel } from './cancel';
import { get } from './get';
import { inputItems } from './inputItems';
import type { AppEnv } from '@/types/env';

const responseIdRouter = new Hono<AppEnv>();

responseIdRouter.get('/', get);
responseIdRouter.post('/cancel', cancel);
responseIdRouter.get('/input_items', inputItems);

export default responseIdRouter;

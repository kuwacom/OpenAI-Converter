import { Hono } from 'hono';
import { post } from './post';
import responseIdRouter from './[responseId]';
import type { AppEnv } from '@/types/env';

const responsesRouter = new Hono<AppEnv>();

responsesRouter.post('/', post);
responsesRouter.route('/:responseId', responseIdRouter);

export default responsesRouter;

import { Hono } from 'hono';
import healthRouter from '@/routes/v1/health';
import responsesRouter from '@/routes/v1/responses';

const v1Router = new Hono();

v1Router.route('/health', healthRouter);
v1Router.route('/responses', responsesRouter);

export default v1Router;

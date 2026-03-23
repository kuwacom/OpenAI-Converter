import { Hono } from 'hono';
import {
  cancelResponseHandler,
  createResponseHandler,
  getResponseHandler,
  getResponseInputItemsHandler,
} from '@/routes/v1/responses/responses.controller';

const responsesRouter = new Hono();

responsesRouter.post('/', createResponseHandler);
responsesRouter.get('/:responseId', getResponseHandler);
responsesRouter.post('/:responseId/cancel', cancelResponseHandler);
responsesRouter.get('/:responseId/input_items', getResponseInputItemsHandler);

export default responsesRouter;

import type { Context } from 'hono';
import { getAppConfig } from '@/configs/env';
import { CreateResponseRequestSchema } from '@/schemas/openai/responses';
import type { CreateResponseRequest } from '@/models/openai/responses';
import {
  cancelResponse,
  createResponse,
  createStreamingResponse,
  getResponse,
  getResponseInputItems,
} from '@/services/proxy/create-response.service';
import { HttpError } from '@/types/errors';

const requireResponseId = (c: Context) => {
  const responseId = c.req.param('responseId');

  if (!responseId) {
    throw new HttpError(400, 'responseId is required');
  }

  return responseId;
};

export const createResponseHandler = async (c: Context) => {
  const payload: CreateResponseRequest = CreateResponseRequestSchema.parse(
    await c.req.json(),
  );
  const config = getAppConfig();

  if (payload.stream) {
    return createStreamingResponse(payload, config);
  }

  const response = await createResponse(payload, config);
  const statusCode = response.status === 'in_progress' ? 202 : 200;
  c.status(statusCode);
  return c.json(response);
};

export const getResponseHandler = async (c: Context) => {
  const response = await getResponse(requireResponseId(c));
  return c.json(response);
};

export const cancelResponseHandler = async (c: Context) => {
  const response = await cancelResponse(requireResponseId(c));
  return c.json(response);
};

export const getResponseInputItemsHandler = async (c: Context) => {
  const response = await getResponseInputItems(requireResponseId(c));
  return c.json(response);
};

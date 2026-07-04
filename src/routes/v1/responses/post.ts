import type { Context } from 'hono';
import { apiError, ErrorCode } from '@/lib/apiError';
import { getAppConfig } from '@/configs/env';
import { CreateResponseRequestSchema } from '@/schemas/responsesSchema';
import type { CreateResponseRequest } from '@/models/responsesModel';
import {
  createResponse,
  createStreamingResponse,
} from '@/services/proxy/create-response.service';
import type { AppEnv } from '@/types/env';

/**
 * ### post
 * /v1/responses の POST を処理する
 * safeParse でバリデーションし、stream 時は SSE を、background 時は 202 を返す
 *
 * @param c - Hono コンテキスト
 * @returns レスポンス送信完了
 */
export const post = async (c: Context<AppEnv>) => {
  const parsed = CreateResponseRequestSchema.safeParse(await c.req.json());

  if (!parsed.success) {
    throw apiError(ErrorCode.VALIDATION_ERROR, parsed.error.issues);
  }

  const payload: CreateResponseRequest = parsed.data;
  const config = getAppConfig(c.env);

  if (payload.stream) {
    return createStreamingResponse(payload, config);
  }

  const response = await createResponse(payload, config);
  const statusCode = response.status === 'in_progress' ? 202 : 200;
  c.status(statusCode);

  return c.json(response);
};

import type { Context } from 'hono';
import { apiError, ErrorCode } from '@/lib/apiError';
import { ResponseIdParamsSchema } from '@/schemas/responsesSchema';
import { getResponseInputItems } from '@/services/proxy/create-response.service';
import type { AppEnv } from '@/types/env';

/**
 * ### inputItems
 * /v1/responses/:responseId/input_items の GET を処理する
 *
 * @param c - Hono コンテキスト
 * @returns レスポンス送信完了
 */
export const inputItems = async (c: Context<AppEnv>) => {
  const parsed = ResponseIdParamsSchema.safeParse(c.req.param());

  if (!parsed.success) {
    throw apiError(ErrorCode.VALIDATION_ERROR, parsed.error.issues);
  }

  const response = await getResponseInputItems(parsed.data.responseId);
  return c.json(response);
};

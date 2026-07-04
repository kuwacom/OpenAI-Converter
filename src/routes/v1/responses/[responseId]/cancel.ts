import type { Context } from 'hono';
import { apiError, ErrorCode } from '@/lib/apiError';
import { ResponseIdParamsSchema } from '@/schemas/responsesSchema';
import { cancelResponse } from '@/services/proxy/createResponseService';
import type { AppEnv } from '@/types/env';

/**
 * ### cancel
 * /v1/responses/:responseId/cancel の POST を処理する
 *
 * @param c - Hono コンテキスト
 * @returns レスポンス送信完了
 */
export const cancel = async (c: Context<AppEnv>) => {
  const parsed = ResponseIdParamsSchema.safeParse(c.req.param());

  if (!parsed.success) {
    throw apiError(ErrorCode.VALIDATION_ERROR, parsed.error.issues);
  }

  const response = await cancelResponse(parsed.data.responseId);
  return c.json(response);
};

import type { Context } from 'hono';
import { apiError, ErrorCode } from '@/lib/apiError';
import { ResponseIdParamsSchema } from '@/schemas/responsesSchema';
import { getResponse } from '@/services/proxy/createResponseService';
import type { AppEnv } from '@/types/env';

/**
 * ### get
 * /v1/responses/:responseId の GET を処理する
 *
 * @param c - Hono コンテキスト
 * @returns レスポンス送信完了
 */
export const get = async (c: Context<AppEnv>) => {
  const parsed = ResponseIdParamsSchema.safeParse(c.req.param());

  if (!parsed.success) {
    throw apiError(ErrorCode.VALIDATION_ERROR, parsed.error.issues);
  }

  const response = await getResponse(parsed.data.responseId);
  return c.json(response);
};

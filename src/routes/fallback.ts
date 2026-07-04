import type { Context } from 'hono';
import { apiError, ErrorCode } from '@/lib/apiError';
import type { AppEnv } from '@/types/env';

/**
 * ### fallback
 * /v1 以外へのアクセスを拒否する
 *
 * @param c - Hono コンテキスト
 * @returns FORBIDDEN エラーレスポンス
 */
export const fallback = (c: Context<AppEnv>) => {
  const error = apiError(ErrorCode.FORBIDDEN);
  return c.json(error.toResponse(), error.statusCode);
};

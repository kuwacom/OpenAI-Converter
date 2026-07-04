import type { Context } from 'hono';
import { apiError, ErrorCode } from '@/lib/apiError';
import type { AppEnv } from '@/types/env';

/**
 * ### fallback
 * /v1 配下の未定義 route を 404 として扱う
 *
 * @param c - Hono コンテキスト
 * @returns NOT_FOUND エラーレスポンス
 */
export const fallback = (c: Context<AppEnv>) => {
  const error = apiError(ErrorCode.NOT_FOUND, 'Endpoint');
  return c.json(error.toResponse(), error.statusCode);
};

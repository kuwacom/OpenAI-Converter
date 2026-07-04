import type { Context } from 'hono';
import { getAppConfig } from '@/configs/env';
import type { AppEnv } from '@/types/env';

/**
 * ### get
 * /v1/health を処理し、現在の default backend を返す
 *
 * @param c - Hono コンテキスト
 * @returns レスポンス送信完了
 */
export const get = (c: Context<AppEnv>) => {
  const config = getAppConfig(c.env);
  return c.json({
    status: 'ok',
    backend: config.defaultBackend,
  });
};

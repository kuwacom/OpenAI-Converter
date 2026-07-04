import { z } from 'zod';
import {
  DEFAULT_BACKEND,
  DEFAULT_CORS_ORIGIN,
  DEFAULT_HOST,
  DEFAULT_LOG_LEVEL,
  DEFAULT_PORT,
} from '@/configs/constants';

// AppConfig へ渡す前の Zod 入力スキーマ。
// bindings/process.env 共に同一キーを受け付けるため空文字許容ゆるめに設定する
export const EnvSchema = z.object({
  HOST: z.string().default(DEFAULT_HOST),
  PORT: z.coerce.number().int().positive().default(DEFAULT_PORT),
  CORS_ORIGIN: z.string().default(DEFAULT_CORS_ORIGIN),
  // Cloudflare Workers vars 未指定は undefined 扱いのため optional 化する
  UPSTREAM_BASE_URL: z.string().url().optional(),
  UPSTREAM_MODEL: z.string().optional(),
  UPSTREAM_API_KEY: z.string().optional(),
  DEFAULT_BACKEND: z.string().default(DEFAULT_BACKEND),
  LOG_LEVEL: z
    .enum(['silly', 'trace', 'debug', 'info', 'warn', 'error', 'fatal'])
    .default(DEFAULT_LOG_LEVEL),
});

export type EnvShape = z.infer<typeof EnvSchema>;

// 未指定時 fallback を供給する。DEFAULT_UPSTREAM_* 系は constants 側で import 循環回避のため分離済み。
// DEFAULT_UPSTREAM_BASE_URL/MODEL 直参照すると constants ⇄ envSchema の循環になるため、
// resolveUpstream* 関数経由で遅延解決させ、constants への依存方向を一本化している
const FALLBACK_UPSTREAM_BASE_URL = 'https://api.openai.com/v1';
const FALLBACK_UPSTREAM_MODEL = '';

export const resolveUpstreamBaseUrl = (value: string | undefined): string =>
  value && value.length > 0 ? value : FALLBACK_UPSTREAM_BASE_URL;

export const resolveUpstreamModel = (value: string | undefined): string =>
  value && value.length > 0 ? value : FALLBACK_UPSTREAM_MODEL;

export const resolveUpstreamApiKey = (value: string | undefined): string =>
  value ?? '';

import { z } from 'zod';
import {
  DEFAULT_BACKEND,
  DEFAULT_CORS_ORIGIN,
  DEFAULT_HOST,
  DEFAULT_LOG_LEVEL,
  DEFAULT_PORT,
  WEB_SEARCH_DEFAULT_LIMIT,
  WEB_SEARCH_EXTRACT_CHAR_LIMIT,
  WEB_SEARCH_FETCH_MAX_BYTES,
  WEB_SEARCH_FETCH_MAX_PAGES_PER_CALL,
  WEB_SEARCH_FETCH_TIMEOUT_MS,
  WEB_SEARCH_MAX_LIMIT,
  WEB_SEARCH_SEARXNG_BASE_URL,
  WEB_SEARCH_SEARXNG_CLIENT_IP,
  WEB_SEARCH_SEARXNG_LANGUAGE,
  WEB_SEARCH_SEARXNG_QUERY_URL,
  WEB_SEARCH_TIMEOUT_MS,
  WEB_SEARCH_USER_AGENT,
  WEB_SEARCH_DEFAULT_USER_LOCATION_CITY,
  WEB_SEARCH_DEFAULT_USER_LOCATION_COUNTRY,
  WEB_SEARCH_DEFAULT_USER_LOCATION_REGION,
  WEB_SEARCH_DEFAULT_USER_LOCATION_TIMEZONE,
  WEB_SEARCH_DEFAULT_USER_LOCATION_TYPE,
} from '@/configs/constants';

// AppConfig へ渡す前の Zod 入力スキーマ。
// bindings/process.env 共に同一キーを受け付けるため空文字許容ゆるめに設定する
export const EnvSchema = z.object({
  HOST: z.string().default(DEFAULT_HOST),
  PORT: z.coerce.number().int().positive().default(DEFAULT_PORT),
  CORS_ORIGIN: z.string().default(DEFAULT_CORS_ORIGIN),

  // ビルトイン web_search(SearXNG)設定群。全て文字列前提で受領後 config 側で型変換する。
  // 空文字は無効化扱い(stub fallback)のため url() バリデーションではなく string() 受領を採用
  WEB_SEARCH_SEARXNG_BASE_URL: z.string().default(WEB_SEARCH_SEARXNG_BASE_URL),
  WEB_SEARCH_SEARXNG_QUERY_URL: z.string().default(WEB_SEARCH_SEARXNG_QUERY_URL),
  WEB_SEARCH_SEARXNG_LANGUAGE: z
    .string()
    .default(WEB_SEARCH_SEARXNG_LANGUAGE),
  WEB_SEARCH_SEARXNG_CLIENT_IP: z
    .string()
    .default(WEB_SEARCH_SEARXNG_CLIENT_IP),
  WEB_SEARCH_USER_AGENT: z.string().default(WEB_SEARCH_USER_AGENT),
  WEB_SEARCH_DEFAULT_LIMIT: z.coerce
    .number()
    .int()
    .positive()
    .default(WEB_SEARCH_DEFAULT_LIMIT),
  WEB_SEARCH_MAX_LIMIT: z.coerce.number().int().positive().default(
    WEB_SEARCH_MAX_LIMIT
  ),
  WEB_SEARCH_FETCH_MAX_PAGES_PER_CALL: z.coerce
    .number()
    .int()
    .positive()
    .default(WEB_SEARCH_FETCH_MAX_PAGES_PER_CALL),
  WEB_SEARCH_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(WEB_SEARCH_TIMEOUT_MS),
  WEB_SEARCH_FETCH_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(WEB_SEARCH_FETCH_TIMEOUT_MS),
  WEB_SEARCH_FETCH_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(WEB_SEARCH_FETCH_MAX_BYTES),
  WEB_SEARCH_EXTRACT_CHAR_LIMIT: z.coerce
    .number()
    .int()
    .positive()
    .default(WEB_SEARCH_EXTRACT_CHAR_LIMIT),

  // env 既定ユーザ位置情報群(位置補強不要時は空文字で OK)
  WEB_SEARCH_DEFAULT_USER_LOCATION_TYPE: z
    .string()
    .default(WEB_SEARCH_DEFAULT_USER_LOCATION_TYPE),
  WEB_SEARCH_DEFAULT_USER_LOCATION_CITY: z
    .string()
    .default(WEB_SEARCH_DEFAULT_USER_LOCATION_CITY),
  WEB_SEARCH_DEFAULT_USER_LOCATION_REGION: z
    .string()
    .default(WEB_SEARCH_DEFAULT_USER_LOCATION_REGION),
  WEB_SEARCH_DEFAULT_USER_LOCATION_COUNTRY: z
    .string()
    .default(WEB_SEARCH_DEFAULT_USER_LOCATION_COUNTRY),
  WEB_SEARCH_DEFAULT_USER_LOCATION_TIMEZONE: z
    .string()
    .default(WEB_SEARCH_DEFAULT_USER_LOCATION_TIMEZONE),

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

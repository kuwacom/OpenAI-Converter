import { z } from 'zod';
import {
  DEFAULT_BACKEND,
  DEFAULT_CORS_ORIGIN,
  DEFAULT_HOST,
  DEFAULT_LLAMACPP_BASE_URL,
  DEFAULT_LLAMACPP_MODEL,
  DEFAULT_LOG_LEVEL,
  DEFAULT_OPENAI_COMPATIBLE_MODEL,
  DEFAULT_PORT,
} from '@/configs/constants';

export const EnvSchema = z.object({
  HOST: z.string().default(DEFAULT_HOST),
  PORT: z.coerce.number().int().positive().default(DEFAULT_PORT),
  CORS_ORIGIN: z.string().default(DEFAULT_CORS_ORIGIN),
  LLAMACPP_BASE_URL: z.string().url().default(DEFAULT_LLAMACPP_BASE_URL),
  LLAMACPP_MODEL: z.string().default(DEFAULT_LLAMACPP_MODEL),
  OPENAI_COMPATIBLE_BASE_URL: z.string().url().optional(),
  OPENAI_COMPATIBLE_MODEL: z.string().default(DEFAULT_OPENAI_COMPATIBLE_MODEL),
  DEFAULT_BACKEND: z.string().default(DEFAULT_BACKEND),
  LOG_LEVEL: z
    .enum(['silly', 'trace', 'debug', 'info', 'warn', 'error', 'fatal'])
    .default(DEFAULT_LOG_LEVEL),
});

export type EnvShape = z.infer<typeof EnvSchema>;

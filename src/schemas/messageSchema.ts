import { z } from 'zod';
import { CanonicalContentPartSchema } from '@/schemas/contentSchema';

export const CanonicalToolCallSchema = z.object({
  id: z.string(),
  callId: z.string(),
  type: z.enum(['function', 'custom', 'builtin', 'mcp', 'unknown']),
  name: z.string(),
  wireName: z.string(),
  // 名前空間子関数として展開された呼び出しの場合のみ設定。
  // canonicalToResponse 出力時に Responses 形式へ namespace フィールドを復元するための往復情報
  parentNamespace: z.string().optional(),
  arguments: z.unknown().optional(),
  rawArguments: z.string().optional(),
  originalType: z.string().optional(),
  status: z.string().default('completed'),
  raw: z.unknown().optional(),
});

export const CanonicalMessageSchema = z.object({
  id: z.string(),
  role: z.enum(['system', 'developer', 'user', 'assistant', 'tool']),
  content: z.array(CanonicalContentPartSchema),
  toolCalls: z.array(CanonicalToolCallSchema).optional(),
  toolCallId: z.string().optional(),
  name: z.string().optional(),
  raw: z.unknown().optional(),
});

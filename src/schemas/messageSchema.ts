import { z } from 'zod';
import { CanonicalContentPartSchema } from '@/schemas/contentSchema';

export const CanonicalToolCallSchema = z.object({
  id: z.string(),
  callId: z.string(),
  type: z.enum(['function', 'custom', 'builtin', 'mcp', 'unknown']),
  name: z.string(),
  wireName: z.string(),
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

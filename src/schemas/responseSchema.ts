import { z } from 'zod';
import { CanonicalContentPartSchema } from '@/schemas/contentSchema';
import {
  CanonicalMessageSchema,
  CanonicalToolCallSchema,
} from '@/schemas/messageSchema';
import {
  CanonicalToolChoiceSchema,
  CanonicalToolSchema,
} from '@/schemas/toolSchema';

export const CanonicalUsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
    reasoningTokens: z.number().int().nonnegative().optional(),
    totalTokens: z.number().int().nonnegative().optional(),
  })
  .passthrough();

export const CanonicalOutputMessageSchema = z.object({
  kind: z.literal('message'),
  id: z.string(),
  status: z.string(),
  role: z.literal('assistant'),
  content: z.array(CanonicalContentPartSchema),
});

export const CanonicalOutputToolCallSchema = z.object({
  kind: z.literal('tool_call'),
  id: z.string(),
  status: z.string(),
  toolCall: CanonicalToolCallSchema,
});

export const CanonicalOutputReasoningSchema = z.object({
  kind: z.literal('reasoning'),
  id: z.string(),
  status: z.string(),
  text: z.string(),
  encryptedContent: z.string().optional(),
});

export const CanonicalResponseOutputSchema = z.union([
  CanonicalOutputMessageSchema,
  CanonicalOutputToolCallSchema,
  CanonicalOutputReasoningSchema,
]);

export const CanonicalResponseSchema = z.object({
  id: z.string(),
  object: z.literal('response'),
  createdAt: z.number().int(),
  completedAt: z.number().int().optional(),
  status: z.string(),
  background: z.boolean().optional(),
  model: z.string(),
  output: z.array(CanonicalResponseOutputSchema),
  messages: z.array(CanonicalMessageSchema).optional(),
  text: z.string().optional(),
  reasoning: z
    .object({
      effort: z
        .enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh'])
        .optional()
        .nullable(),
      summary: z.string().optional().nullable(),
      encryptedContent: z.string().optional(),
    })
    .passthrough()
    .optional(),
  usage: CanonicalUsageSchema.optional(),
  error: z.unknown().nullable().optional(),
  incompleteDetails: z.unknown().nullable().optional(),
  instructions: z.string().nullable().optional(),
  maxOutputTokens: z.number().nullable().optional(),
  maxToolCalls: z.number().nullable().optional(),
  parallelToolCalls: z.boolean().default(true),
  previousResponseId: z.string().nullable().optional(),
  serviceTier: z.string().optional(),
  store: z.boolean().optional(),
  temperature: z.number().nullable().optional(),
  toolChoice: CanonicalToolChoiceSchema.optional(),
  tools: z.array(CanonicalToolSchema).default([]),
  topP: z.number().nullable().optional(),
  truncation: z.string().default('disabled'),
  user: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.string()).default({}),
  include: z.array(z.string()).default([]),
  raw: z.record(z.string(), z.unknown()).optional(),
});

import { z } from 'zod';
import { CanonicalMessageSchema } from '@/schemas/canonical/message';
import {
  CanonicalToolChoiceSchema,
  CanonicalToolSchema,
} from '@/schemas/canonical/tool';

export const CanonicalRequestSchema = z.object({
  id: z.string(),
  model: z.string(),
  instructions: z.string().optional(),
  messages: z.array(CanonicalMessageSchema),
  tools: z.array(CanonicalToolSchema),
  toolChoice: CanonicalToolChoiceSchema.optional(),
  parallelToolCalls: z.boolean().default(true),
  reasoning: z
    .object({
      effort: z
        .enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh'])
        .optional(),
      summary: z.unknown().optional(),
    })
    .passthrough()
    .optional(),
  stream: z.boolean().default(false),
  background: z.boolean().default(false),
  include: z.array(z.string()).default([]),
  metadata: z.record(z.string(), z.string()).default({}),
  maxOutputTokens: z.number().int().positive().optional(),
  maxToolCalls: z.number().int().positive().optional(),
  previousResponseId: z.string().nullable().optional(),
  temperature: z.number().min(0).max(2).optional(),
  topP: z.number().min(0).max(1).optional(),
  store: z.boolean().optional(),
  serviceTier: z.string().optional(),
  text: z.record(z.string(), z.unknown()).optional(),
  truncation: z.string().default('disabled'),
  raw: z.record(z.string(), z.unknown()),
});

export type CanonicalRequest = z.infer<typeof CanonicalRequestSchema>;

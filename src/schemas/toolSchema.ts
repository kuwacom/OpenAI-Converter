import { z } from 'zod';

export const CanonicalToolSchema = z.object({
  id: z.string(),
  type: z.enum(['function', 'custom', 'builtin', 'mcp', 'unknown']),
  name: z.string(),
  wireName: z.string(),
  description: z.string().optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
  strict: z.boolean().optional(),
  originalType: z.string().optional(),
  raw: z.record(z.string(), z.unknown()),
});

export const CanonicalToolChoiceSchema = z.union([
  z.enum(['none', 'auto', 'required']),
  z.object({
    type: z.string(),
    name: z.string().optional(),
  }),
  z.record(z.string(), z.unknown()),
]);

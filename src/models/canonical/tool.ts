import type { output as ZodOutput } from 'zod';
import type {
  CanonicalToolChoiceSchema,
  CanonicalToolSchema,
} from '@/schemas/canonical/tool';

export type CanonicalTool = ZodOutput<typeof CanonicalToolSchema>;
export type CanonicalToolChoice = ZodOutput<typeof CanonicalToolChoiceSchema>;

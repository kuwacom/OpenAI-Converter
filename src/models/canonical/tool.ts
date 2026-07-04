import type { output as ZodOutput } from 'zod';
import type {
  CanonicalToolChoiceSchema,
  CanonicalToolSchema,
} from '@/schemas/toolSchema';

export type CanonicalTool = ZodOutput<typeof CanonicalToolSchema>;
export type CanonicalToolChoice = ZodOutput<typeof CanonicalToolChoiceSchema>;

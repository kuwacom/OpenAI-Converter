import type { output as ZodOutput } from 'zod';
import type {
  CanonicalMessageSchema,
  CanonicalToolCallSchema,
} from '@/schemas/canonical/message';

export type CanonicalMessage = ZodOutput<typeof CanonicalMessageSchema>;
export type CanonicalToolCall = ZodOutput<typeof CanonicalToolCallSchema>;

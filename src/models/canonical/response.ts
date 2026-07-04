import type { output as ZodOutput } from 'zod';
import type { CanonicalRequestSchema } from '@/schemas/requestSchema';
import type {
  CanonicalResponseOutputSchema,
  CanonicalResponseSchema,
} from '@/schemas/responseSchema';

export type CanonicalRequest = ZodOutput<typeof CanonicalRequestSchema>;
export type CanonicalResponse = ZodOutput<typeof CanonicalResponseSchema>;
export type CanonicalResponseOutput = ZodOutput<
  typeof CanonicalResponseOutputSchema
>;
export type { CanonicalMessage } from '@/models/canonical/message';
export type { CanonicalTool } from '@/models/canonical/tool';

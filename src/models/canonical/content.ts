import type { output as ZodOutput } from 'zod';
import type { CanonicalContentPartSchema } from '@/schemas/canonical/content';

export type CanonicalContentPart = ZodOutput<typeof CanonicalContentPartSchema>;

import type { output as ZodOutput } from 'zod';
import type { CanonicalContentPartSchema } from '@/schemas/contentSchema';

export type CanonicalContentPart = ZodOutput<typeof CanonicalContentPartSchema>;

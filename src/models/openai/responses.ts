import type { output as ZodOutput } from 'zod';
import type {
  CreateResponseRequestSchema,
  ResponseSchema,
  ResponseStreamEventSchema,
} from '@/schemas/openai/responses';

export type CreateResponseRequest = ZodOutput<
  typeof CreateResponseRequestSchema
>;
export type OpenAIResponse = ZodOutput<typeof ResponseSchema>;
export type ResponseStreamEvent = ZodOutput<typeof ResponseStreamEventSchema>;

import type { output as ZodOutput } from 'zod';
import type {
  ChatCompletionMessageSchema,
  ChatCompletionRequestSchema,
  ChatCompletionResponseSchema,
} from '@/schemas/chatCompletionsSchema';

export type ChatCompletionMessage = ZodOutput<
  typeof ChatCompletionMessageSchema
>;
export type ChatCompletionRequest = ZodOutput<
  typeof ChatCompletionRequestSchema
>;
export type ChatCompletionResponse = ZodOutput<
  typeof ChatCompletionResponseSchema
>;

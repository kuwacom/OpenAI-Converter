import type { output as ZodOutput } from 'zod';
import type {
  LlamaCppChatCompletionMessageSchema,
  LlamaCppChatCompletionRequestSchema,
  LlamaCppChatCompletionResponseSchema,
} from '@/schemas/llamacpp/chat-completions';

export type LlamaCppChatCompletionMessage = ZodOutput<
  typeof LlamaCppChatCompletionMessageSchema
>;
export type LlamaCppChatCompletionRequest = ZodOutput<
  typeof LlamaCppChatCompletionRequestSchema
>;
export type LlamaCppChatCompletionResponse = ZodOutput<
  typeof LlamaCppChatCompletionResponseSchema
>;

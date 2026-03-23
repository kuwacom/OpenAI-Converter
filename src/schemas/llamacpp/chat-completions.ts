import { z } from 'zod';

export const LlamaCppChatCompletionMessageSchema = z
  .object({
    role: z.string(),
    content: z.string().optional().nullable(),
    name: z.string().optional(),
    tool_call_id: z.string().optional(),
    tool_calls: z.array(z.record(z.string(), z.unknown())).optional(),
  })
  .passthrough();

export const LlamaCppChatCompletionRequestSchema = z
  .object({
    model: z.string().optional(),
    messages: z.array(LlamaCppChatCompletionMessageSchema),
    tools: z.array(z.record(z.string(), z.unknown())).optional(),
    tool_choice: z.unknown().optional(),
    parallel_tool_calls: z.boolean().optional(),
    stream: z.boolean().optional(),
    temperature: z.number().optional(),
    top_p: z.number().optional(),
    max_tokens: z.number().int().positive().optional(),
    response_format: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export const LlamaCppChatCompletionChoiceSchema = z
  .object({
    index: z.number().int(),
    finish_reason: z.string().nullable().optional(),
    message: LlamaCppChatCompletionMessageSchema.optional(),
    delta: LlamaCppChatCompletionMessageSchema.optional(),
  })
  .passthrough();

export const LlamaCppChatCompletionResponseSchema = z
  .object({
    id: z.string().optional(),
    object: z.string().optional(),
    created: z.number().int().optional(),
    model: z.string().optional(),
    choices: z.array(LlamaCppChatCompletionChoiceSchema),
    usage: z
      .object({
        prompt_tokens: z.number().int().optional(),
        completion_tokens: z.number().int().optional(),
        total_tokens: z.number().int().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

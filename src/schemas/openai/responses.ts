import { z } from 'zod';

const withNullAsUndefined = <TSchema extends z.ZodTypeAny>(schema: TSchema) =>
  z.preprocess((value) => (value === null ? undefined : value), schema);

const withNullAsDefault = <TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  fallback: z.infer<TSchema>,
) =>
  z.preprocess(
    (value) => (value === null ? undefined : value),
    schema.default(fallback),
  );

export const MetadataSchema = z.record(z.string(), z.string());

export const LooseObjectSchema = z.record(z.string(), z.unknown());

export const ResponseReasoningSchema = z
  .object({
    effort: z
      .enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh'])
      .optional()
      .nullable(),
    summary: z.unknown().optional().nullable(),
  })
  .passthrough();

export const ResponseTextSchema = z
  .object({
    format: z
      .object({
        type: z.string(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const CreateResponseRequestSchema = z
  .object({
    model: z.string(),
    input: z
      .union([z.string(), z.array(z.union([z.string(), LooseObjectSchema]))])
      .optional(),
    instructions: z.string().optional().nullable(),
    tools: withNullAsDefault(z.array(LooseObjectSchema).optional(), []),
    tool_choice: withNullAsUndefined(z.unknown().optional()),
    parallel_tool_calls: withNullAsDefault(z.boolean().optional(), true),
    reasoning: withNullAsUndefined(ResponseReasoningSchema.optional()),
    stream: withNullAsDefault(z.boolean().optional(), false),
    stream_options: withNullAsUndefined(LooseObjectSchema.optional()),
    background: withNullAsDefault(z.boolean().optional(), false),
    include: withNullAsDefault(z.array(z.string()).optional(), []),
    metadata: withNullAsDefault(MetadataSchema.optional(), {}),
    max_output_tokens: z.number().int().positive().optional().nullable(),
    max_tool_calls: z.number().int().positive().optional().nullable(),
    previous_response_id: z.string().optional().nullable(),
    temperature: z.number().min(0).max(2).optional().nullable(),
    top_p: z.number().min(0).max(1).optional().nullable(),
    store: withNullAsUndefined(z.boolean().optional()),
    service_tier: z.string().optional().nullable(),
    text: withNullAsUndefined(ResponseTextSchema.optional()),
    truncation: z.string().optional().default('disabled'),
    user: z.string().optional().nullable(),
    conversation: withNullAsUndefined(LooseObjectSchema.optional()),
  })
  .passthrough();

export const ResponseOutputTextSchema = z
  .object({
    type: z.literal('output_text'),
    text: z.string(),
    annotations: z.array(LooseObjectSchema).default([]),
    logprobs: z.array(LooseObjectSchema).optional(),
  })
  .passthrough();

export const ResponseMessageSchema = z
  .object({
    id: z.string(),
    type: z.literal('message'),
    status: z.string(),
    role: z.string(),
    content: z.array(z.union([ResponseOutputTextSchema, LooseObjectSchema])),
  })
  .passthrough();

export const ResponseFunctionCallSchema = z
  .object({
    id: z.string(),
    type: z.literal('function_call'),
    call_id: z.string(),
    name: z.string(),
    arguments: z.string(),
    status: z.string(),
  })
  .passthrough();

export const ResponseGenericOutputItemSchema = z
  .object({
    id: z.string().optional(),
    type: z.string(),
  })
  .passthrough();

export const ResponseSchema = z
  .object({
    id: z.string(),
    object: z.literal('response'),
    created_at: z.number().int(),
    status: z.string(),
    completed_at: z.number().int().optional(),
    background: z.boolean().optional(),
    error: z.unknown().nullable().optional(),
    incomplete_details: z.unknown().nullable().optional(),
    instructions: z.string().nullable().optional(),
    max_output_tokens: z.number().nullable().optional(),
    max_tool_calls: z.number().nullable().optional(),
    model: z.string(),
    output: z.array(
      z.union([
        ResponseMessageSchema,
        ResponseFunctionCallSchema,
        ResponseGenericOutputItemSchema,
      ]),
    ),
    parallel_tool_calls: z.boolean().default(true),
    previous_response_id: z.string().nullable().optional(),
    reasoning: ResponseReasoningSchema.optional(),
    service_tier: z.string().optional(),
    store: z.boolean().optional(),
    temperature: z.number().nullable().optional(),
    text: ResponseTextSchema.optional(),
    tool_choice: z.unknown().optional(),
    tools: z.array(LooseObjectSchema).optional(),
    top_p: z.number().nullable().optional(),
    truncation: z.string().optional(),
    usage: z.unknown().optional().nullable(),
    user: z.string().nullable().optional(),
    metadata: MetadataSchema.default({}),
  })
  .passthrough();

export const ResponseStreamEventSchema = z
  .object({
    type: z.string(),
  })
  .passthrough();

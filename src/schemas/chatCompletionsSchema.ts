import { z } from 'zod';

// 汎用 OpenAI 互換 Chat Completions 上流向けスキーマ定義
// 上流プロバイダごとの拡張フィールド(reasoning_content 等)を取りこぼさないため全て passthrough にする
export const ChatCompletionMessageSchema = z
  .object({
    role: z.string(),
    content: z
      .union([z.string(), z.array(z.record(z.string(), z.unknown()))])
      .nullable()
      .optional(),
    // 思考モデルが返す推論テキスト。DeepSeek/Kimi/GLM 系で利用され Codex の reasoning summary になる
    reasoning_content: z.string().optional().nullable(),
    reasoning: z.unknown().optional().nullable(),
    name: z.string().optional(),
    tool_call_id: z.string().optional(),
    tool_calls: z.array(z.record(z.string(), z.unknown())).optional(),
  })
  .passthrough();

// SSE ストリーミングチャンクの差分(delta)向け緩いスキーマ。
// OpenAI 仕様上、先頭チャンクでのみ role:"assistant" が入り、以降は content/tool_calls 等が断片的に届く。
// 完全メッセージと同じくすべて passthrough にし、未知拡張フィールドも取りこぼさない
export const ChatCompletionDeltaSchema = z
  .object({
    role: z.string().optional(),
    content: z
      .union([z.string(), z.array(z.record(z.string(), z.unknown()))])
      .nullable()
      .optional(),
    reasoning_content: z.string().optional().nullable(),
    reasoning: z.unknown().optional().nullable(),
    name: z.string().optional(),
    tool_call_id: z.string().optional(),
    tool_calls: z.array(z.record(z.string(), z.unknown())).optional(),
  })
  .passthrough();

export const ChatCompletionRequestSchema = z
  .object({
    model: z.string().optional(),
    messages: z.array(ChatCompletionMessageSchema),
    tools: z.array(z.record(z.string(), z.unknown())).optional(),
    tool_choice: z.unknown().optional(),
    parallel_tool_calls: z.boolean().optional(),
    stream: z.boolean().optional(),
    temperature: z.number().optional(),
    top_p: z.number().optional(),
    max_tokens: z.number().int().positive().optional(),
    max_completion_tokens: z.number().int().positive().optional(),
    response_format: z.record(z.string(), z.unknown()).optional(),
    // 一部上流は prompt 回答に影響するので Codex 由来 effort を渡せるようにしておく
    reasoning_effort: z.string().optional(),
    stop: z.union([z.string(), z.array(z.string())]).optional(),
    seed: z.number().int().optional(),
    n: z.number().int().positive().optional(),
  })
  .passthrough();

export const ChatCompletionChoiceSchema = z
  .object({
    index: z.number().int().optional(),
    finish_reason: z.string().nullable().optional(),
    message: ChatCompletionMessageSchema.optional(),
    delta: ChatCompletionDeltaSchema.optional(),
  })
  .passthrough();

export const ChatCompletionResponseSchema = z
  .object({
    id: z.string().optional(),
    object: z.string().optional(),
    created: z.number().int().optional(),
    model: z.string().optional(),
    // usage 単独チャンクなど choices が空配列で来るケースも透過させる
    choices: z.array(ChatCompletionChoiceSchema).default([]),
    usage: z
      .object({
        prompt_tokens: z.number().int().optional(),
        completion_tokens: z.number().int().optional(),
        total_tokens: z.number().int().optional(),
        prompt_tokens_details: z.record(z.string(), z.unknown()).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

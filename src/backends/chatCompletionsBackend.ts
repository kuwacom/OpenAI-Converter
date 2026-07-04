import {
  createChatCompletion,
  parseChatCompletion,
  parseChatCompletionStream,
} from '@/apiClient/chatCompletionsClient';
import type { BackendAdapter, BackendStreamResult } from '@/types/backend';
import type { CanonicalRequest } from '@/models/canonical/response';
import type { ChatCompletionResponse } from '@/models/chatCompletionsModel';
import { asObject } from '@/utils/json';
import { mapToChatCompletions } from '@/backends/chatCompletionsRequestMapper';
import type { ChatCompletionRequestMapping } from '@/backends/chatCompletionsRequestMapper';
import { mapChatCompletionToCanonicalResponse } from '@/backends/chatCompletionsResponseMapper';
import {
  executeToolLoop,
  synthesizeCanonicalResponseOutputs,
} from '@/services/proxy/tooling';
import { needsUpstreamContinuation } from '@/services/proxy/upstreamContinuation.service';

// ストリーミング時、delta.tool_calls の部分 JSON を index 単位で結合するための可変ラッパー。
// 終端で assistantMessage.tool_calls へ詰め直して response-mapper へ渡す
type MutableStreamToolCall = Record<string, unknown> & {
  function: Record<string, unknown>;
};

const toMutableStreamToolCall = (value: unknown): MutableStreamToolCall => {
  const toolCall = asObject(value) ?? {};
  const functionPayload = asObject(toolCall.function) ?? {};
  return { ...toolCall, function: { ...functionPayload } };
};

// ストリーミングチャンクを1つの非ストリーミング応答相当へ集約する
const accumulateStreamChunk = (
  aggregate: ChatCompletionResponse,
  chunk: ChatCompletionResponse,
): ChatCompletionResponse => {
  const choice = chunk.choices[0];
  const aggregateChoice = aggregate.choices[0];
  if (!choice || !aggregateChoice) return aggregate;

  if (!aggregateChoice.message) {
    aggregateChoice.message = { role: 'assistant', content: '' };
  }

  if (typeof choice.delta?.content === 'string') {
    aggregateChoice.message.content =
      typeof aggregateChoice.message.content === 'string'
        ? `${aggregateChoice.message.content}${choice.delta.content}`
        : choice.delta.content;
  }

  // 思考モデルの推論テキストも蓄積する(応答側で reasoning summary へ反映)
  if (typeof choice.delta?.reasoning_content === 'string') {
    const prior = aggregateChoice.message.reasoning_content ?? '';
    aggregateChoice.message.reasoning_content = `${prior}${choice.delta.reasoning_content}`;
  }

  const deltaToolCalls = choice.delta?.tool_calls;
  if (Array.isArray(deltaToolCalls)) {
    const current = Array.isArray(aggregateChoice.message.tool_calls)
      ? aggregateChoice.message.tool_calls
      : [];

    for (const deltaCallRaw of deltaToolCalls) {
      const deltaCall = toMutableStreamToolCall(deltaCallRaw);
      const idx =
        typeof deltaCall.index === 'number' ? deltaCall.index : current.length;
      const existing = toMutableStreamToolCall(current[idx]);
      const dFunc = deltaCall.function;

      if (typeof deltaCall.id === 'string') existing.id = deltaCall.id;
      if (typeof dFunc?.name === 'string') {
        existing.function.name =
          typeof existing.function.name === 'string'
            ? `${existing.function.name}${dFunc.name}`
            : dFunc.name;
      }
      if (typeof dFunc?.arguments === 'string') {
        existing.function.arguments =
          typeof existing.function.arguments === 'string'
            ? `${existing.function.arguments}${dFunc.arguments}`
            : dFunc.arguments;
      }
      existing.type ??= 'function';
      current[idx] = existing;
    }

    aggregateChoice.message.tool_calls = current;
  }

  if (choice.finish_reason)
    aggregateChoice.finish_reason = choice.finish_reason;
  if (chunk.usage) aggregate.usage = chunk.usage;

  return aggregate;
};

const createEmptyAggregateResponse = (
  request: CanonicalRequest,
): ChatCompletionResponse => ({
  id: undefined,
  object: 'chat.completion.chunk',
  created: Math.floor(Date.now() / 1000),
  model: request.model,
  choices: [
    {
      index: 0,
      finish_reason: null,
      message: { role: 'assistant', content: '' },
    },
  ],
});

type ExecuteContext = {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  signal?: AbortSignal;
};

/**
 * ### resolveBaseUrl
 * closure 内でも string narrowing を維持するため、入口で一度解決する
 */
const resolveBaseContext = (
  context: ExecuteContext,
): {
  baseUrl: string;
  model?: string;
  apiKey?: string;
  signal?: AbortSignal;
} => {
  if (!context.baseUrl) {
    throw new Error('upstream base url required for chat-completions backend');
  }
  return context as Required<Pick<ExecuteContext, 'baseUrl'>> &
    Omit<ExecuteContext, 'baseUrl'>;
};

/**
 * ### executeOpenAICompatibleChatCompletions
 * Chat Completions 上流に対する blocking 実行。tool loop 制御も含む。
 */
export const executeChatCompletionsBlocking = async (
  request: CanonicalRequest,
  context: ExecuteContext,
  options?: { disableToolLoop?: boolean },
) => {
  const base = resolveBaseContext(context);

  const executeTurn = async (nextRequest: CanonicalRequest) => {
    const mapping = mapToChatCompletions(nextRequest, base.model);
    const rawResponse = await createChatCompletion({
      baseUrl: base.baseUrl,
      body: mapping.request,
      signal: base.signal,
      apiKey: base.apiKey,
    });
    const parsedResponse = await parseChatCompletion(rawResponse);
    const canonicalResponse = synthesizeCanonicalResponseOutputs(
      mapChatCompletionToCanonicalResponse(
        nextRequest,
        mapping,
        parsedResponse,
      ),
      nextRequest.tools,
    );

    // apply_patch 形式や tool_call tag 等が未完了なまま途切れていたら中断理由を付与する
    if (
      canonicalResponse.text &&
      needsUpstreamContinuation(canonicalResponse.text)
    ) {
      return {
        ...canonicalResponse,
        incompleteDetails: { reason: 'upstream_truncated' },
      };
    }
    return canonicalResponse;
  };

  const initialResponse = await executeTurn(request);
  if (options?.disableToolLoop) return initialResponse;

  return executeToolLoop({
    request,
    initialResponse,
    executeTurn,
  });
};

/**
 * ### streamChatCompletions
 * SSE 応答を受信しながらテキスト差分を流す。最終的に1つの non-streaming 相当 response へ集約する。
 */
export const streamChatCompletions = async (
  request: CanonicalRequest,
  context: ExecuteContext,
): Promise<BackendStreamResult> => {
  const base = resolveBaseContext(context);

  // streaming 中は backend 側 request.stream も true にしておく
  // mapping 自体は stream:true 指定で生成、その後本体も上書きし二重にならないよう整える
  const mapping: ChatCompletionRequestMapping = mapToChatCompletions(
    { ...request, stream: true },
    base.model,
  );
  const upstreamResponse = await createChatCompletion({
    baseUrl: base.baseUrl,
    body: { ...mapping.request, stream: true },
    signal: base.signal,
    apiKey: base.apiKey,
  });

  const aggregate = createEmptyAggregateResponse(request);

  let resolveFinalResponse!: (
    value: Awaited<BackendStreamResult['finalResponse']>,
  ) => void;
  let rejectFinalResponse!: (reason?: unknown) => void;
  const finalResponse = new Promise<
    Awaited<BackendStreamResult['finalResponse']>
  >((resolve, reject) => {
    resolveFinalResponse = resolve;
    rejectFinalResponse = reject;
  });

  const deltas = (async function* () {
    try {
      for await (const chunk of parseChatCompletionStream(upstreamResponse)) {
        accumulateStreamChunk(aggregate, chunk);
        // CC content は文字列 or parts 配列を取り得る。テキスト差分のみ抽出してクライアントへ流す
        const rawContent = chunk.choices[0]?.delta?.content;
        if (typeof rawContent === 'string' && rawContent.length > 0) {
          yield { textDelta: rawContent };
        }
      }
      resolveFinalResponse(
        synthesizeCanonicalResponseOutputs(
          mapChatCompletionToCanonicalResponse(request, mapping, aggregate),
          request.tools,
        ),
      );
    } catch (error) {
      rejectFinalResponse(error);
      throw error;
    }
  })();

  return { deltas, finalResponse };
};

export const openAICompatibleChatCompletionsBackend: BackendAdapter = {
  id: 'openai-compatible-chat-completions',
  provider: 'openai-compatible',
  wireApi: 'chat-completions',
  execute: async (request, ctx) =>
    executeChatCompletionsBlocking(request, {
      baseUrl: ctx.config.upstreamBaseUrl,
      model: ctx.config.upstreamModel || undefined,
      apiKey: ctx.config.upstreamApiKey || undefined,
      signal: ctx.signal,
    }),
  stream: async (request, ctx) =>
    streamChatCompletions(request, {
      baseUrl: ctx.config.upstreamBaseUrl,
      model: ctx.config.upstreamModel || undefined,
      apiKey: ctx.config.upstreamApiKey || undefined,
      signal: ctx.signal,
    }),
};

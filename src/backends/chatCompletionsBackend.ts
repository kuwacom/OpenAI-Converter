import {
  createChatCompletion,
  parseChatCompletion,
  parseChatCompletionStream,
} from '@/apiClient/chatCompletionsClient';
import type { BackendAdapter, BackendStreamResult } from '@/types/backend';
import type { CanonicalRequest } from '@/models/canonical/response';
import type { ChatCompletionResponse } from '@/models/chatCompletionsModel';
import type { WebSearchConfig } from '@/types/env';
import { asObject } from '@/lib/object';
import { mapToChatCompletions } from '@/backends/chatCompletionsRequestMapper';
import type { ChatCompletionRequestMapping } from '@/backends/chatCompletionsRequestMapper';
import { mapChatCompletionToCanonicalResponse } from '@/backends/chatCompletionsResponseMapper';
import {
  executeToolLoop,
  executeWebSearchSubLoop,
  synthesizeCanonicalResponseOutputs,
} from '@/services/proxy/tooling';
import {
  injectWebSearchContext,
} from '@/services/proxy/webSearchContext';
import { needsUpstreamContinuation } from '@/services/proxy/upstreamContinuationService';

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
  webSearchConfig?: WebSearchConfig;
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
  webSearchConfig?: WebSearchConfig;
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

  // リクエストへ web_search builtin が含まれる場合、合成関数定義+指示注入済みの request へ差し替える。
  // 注入済み effectiveRequest で upstream へ送り、応答後は web_search 専用 proxy 完結型サブループで回す
  const { request: injected, rawToolsForExecute } =
    injectWebSearchContext(request);
  const hasWs = rawToolsForExecute.length > 0;
  const effectiveRequest = injected;

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

  const initialResponse = await executeTurn(effectiveRequest);
  if (options?.disableToolLoop && !(hasWs && base.webSearchConfig)) {
    return initialResponse;
  }

  if (hasWs && base.webSearchConfig) {
    return executeWebSearchSubLoop({
      request: effectiveRequest,
      initialResponse,
      executeTurn,
      rawToolsForExecute,
      webSearchConfig: base.webSearchConfig,
      signal: base.signal,
    });
  }

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

  // streaming 中は backend 側 request.stream も true にしておく。
  // mapping 自体は stream:true 指定で生成、その後本体も上書きし二重にならないよう整える
  // web_search builtin 検知時は合成関数定義+指示注入済み request へ差し替える(blocking 経路と同じ方針)
  const { request: injected, rawToolsForExecute } =
    injectWebSearchContext(request);
  const hasWs = rawToolsForExecute.length > 0;
  const effectiveRequest = injected;

  const mapping: ChatCompletionRequestMapping = mapToChatCompletions(
    { ...effectiveRequest, stream: true },
    base.model,
  );
  const upstreamResponse = await createChatCompletion({
   baseUrl: base.baseUrl,
   body: {
     ...mapping.request,
     stream_options: { include_usage: true },
   },
    // litellm 等の上流でストリーミング時 usage を返させるために必須。
    // 未指定だと上流が usage チャンクを返さず response.completed で usage が null になる
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

        // 思考モデルの推論テキストもクライアントへ delta 配信(codex-relay stream.rs 準拠)。
        // reasoning_content 未配信だと GLM 等で長時間アイドル発生→Codex 側 idle timeout で停止する
        const rawReasoning = chunk.choices[0]?.delta?.reasoning_content ?? chunk.choices[0]?.delta?.reasoning;
        if (typeof rawReasoning === 'string' && rawReasoning.length > 0) {
          yield { reasoningDelta: rawReasoning };
        }
    }
  const initialSynthesized = synthesizeCanonicalResponseOutputs(
    mapChatCompletionToCanonicalResponse(effectiveRequest, mapping, aggregate),
    effectiveRequest.tools,
  );

  // web_search builtin 未検知時はそのまま最終応答。検知時は proxy 完結型サブループで検索結果を取り込み再ターンする。
  // ストリーミング配信済み分(初期テキスト差分)はそのまま流れ、サブループ後の最終回答は上位 createStreamingService 側で上書き反映する
  const webSearchConfig = base.webSearchConfig;
  if (!hasWs || !webSearchConfig) {
    resolveFinalResponse(initialSynthesized);
  } else {
    resolveFinalResponse(
      await executeWebSearchSubLoop({
        request: effectiveRequest,
        initialResponse: initialSynthesized,
        executeTurn: async (nextRequest: CanonicalRequest) => {
          const nonStreamMapping = mapToChatCompletions({ ...nextRequest, stream: false }, base.model);
          const raw = await createChatCompletion({ baseUrl: base.baseUrl, body: nonStreamMapping.request, signal: base.signal, apiKey: base.apiKey });
          const parsed = await parseChatCompletion(raw);
          return synthesizeCanonicalResponseOutputs(mapChatCompletionToCanonicalResponse(nextRequest, nonStreamMapping, parsed), nextRequest.tools);
        },
        rawToolsForExecute,
        webSearchConfig,
       signal: base.signal,
     }),
   );
 }
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
  execute: async (request, ctx, options) =>
    executeChatCompletionsBlocking(request, {
      baseUrl: ctx.config.upstreamBaseUrl,
      model: ctx.config.upstreamModel || undefined,
      apiKey: ctx.config.upstreamApiKey || undefined,
      signal: ctx.signal,
      webSearchConfig: ctx.config.webSearch,
    }, options),
  stream: async (request, ctx) =>
    streamChatCompletions(request, {
      baseUrl: ctx.config.upstreamBaseUrl,
      model: ctx.config.upstreamModel || undefined,
      apiKey: ctx.config.upstreamApiKey || undefined,
      signal: ctx.signal,
      webSearchConfig: ctx.config.webSearch,
    }),
};

import {
  createChatCompletion,
  parseChatCompletion,
  parseChatCompletionStream,
} from '@/api/llamacpp/v1/chat/completions';
import type { BackendAdapter, BackendStreamResult } from '@/types/backend';
import type {
  LlamaCppChatCompletionMessage,
  LlamaCppChatCompletionResponse,
} from '@/models/llamacpp/chat-completions';
import type { CanonicalRequest } from '@/models/canonical/response';
import { asObject } from '@/utils/json';
import { mapCanonicalRequestToLlamaCppQwenRequest } from '@/backends/llamacpp/qwen/request-mapper';
import { mapLlamaCppChatCompletionToCanonicalResponse } from '@/backends/llamacpp/qwen/response-mapper';

type MutableStreamToolCall = Record<string, unknown> & {
  function: Record<string, unknown>;
};

const toMutableStreamToolCall = (value: unknown): MutableStreamToolCall => {
  const toolCall = asObject(value) ?? {};
  const functionPayload = asObject(toolCall.function) ?? {};

  return {
    ...toolCall,
    function: { ...functionPayload },
  };
};

const accumulateStreamChunk = (
  aggregate: LlamaCppChatCompletionResponse,
  chunk: LlamaCppChatCompletionResponse,
) => {
  const choice = chunk.choices[0];

  if (!choice) {
    return aggregate;
  }

  const aggregateChoice = aggregate.choices[0];

  if (!aggregateChoice) {
    return aggregate;
  }

  if (!aggregateChoice.message) {
    aggregateChoice.message = {
      role: 'assistant',
      content: '',
    };
  }

  if (choice.delta?.content) {
    aggregateChoice.message.content =
      (aggregateChoice.message.content ?? '') + choice.delta.content;
  }

  const deltaToolCalls = choice.delta?.tool_calls;
  if (Array.isArray(deltaToolCalls)) {
    const currentToolCalls = Array.isArray(aggregateChoice.message.tool_calls)
      ? aggregateChoice.message.tool_calls
      : [];

    for (const deltaCall of deltaToolCalls) {
      const deltaCallObject = toMutableStreamToolCall(deltaCall);
      const index =
        typeof deltaCallObject.index === 'number'
          ? deltaCallObject.index
          : currentToolCalls.length;
      const existing = toMutableStreamToolCall(currentToolCalls[index]);
      const deltaFunction = deltaCallObject.function;
      const existingFunction = existing.function;

      if (typeof deltaCallObject.id === 'string') {
        existing.id = deltaCallObject.id;
      }

      if (typeof deltaFunction?.name === 'string') {
        existingFunction.name =
          typeof existingFunction.name === 'string'
            ? `${existingFunction.name}${deltaFunction.name}`
            : deltaFunction.name;
      }

      if (typeof deltaFunction?.arguments === 'string') {
        existingFunction.arguments =
          typeof existingFunction.arguments === 'string'
            ? `${existingFunction.arguments}${deltaFunction.arguments}`
            : deltaFunction.arguments;
      }

      existing.function = existingFunction;
      existing.type = existing.type ?? 'function';
      currentToolCalls[index] = existing;
    }

    aggregateChoice.message.tool_calls = currentToolCalls;
  }

  if (choice.finish_reason) {
    aggregateChoice.finish_reason = choice.finish_reason;
  }

  if (chunk.usage) {
    aggregate.usage = chunk.usage;
  }

  return aggregate;
};

const createEmptyAggregateResponse = (
  request: CanonicalRequest,
): LlamaCppChatCompletionResponse => ({
  id: undefined,
  object: 'chat.completion.chunk',
  created: Math.floor(Date.now() / 1000),
  model: request.model,
  choices: [
    {
      index: 0,
      finish_reason: null,
      message: {
        role: 'assistant',
        content: '',
      } satisfies LlamaCppChatCompletionMessage,
    },
  ],
});

export const executeLlamaCppQwen = async (
  request: CanonicalRequest,
  context: { baseUrl: string; model: string; signal?: AbortSignal },
) => {
  const mapping = mapCanonicalRequestToLlamaCppQwenRequest(
    request,
    context.model,
  );
  const rawResponse = await createChatCompletion({
    baseUrl: context.baseUrl,
    body: mapping.request,
    signal: context.signal,
  });
  const parsedResponse = await parseChatCompletion(rawResponse);

  return mapLlamaCppChatCompletionToCanonicalResponse(
    request,
    mapping,
    parsedResponse,
  );
};

export const streamLlamaCppQwen = async (
  request: CanonicalRequest,
  context: { baseUrl: string; model: string; signal?: AbortSignal },
): Promise<BackendStreamResult> => {
  const mapping = mapCanonicalRequestToLlamaCppQwenRequest(
    {
      ...request,
      stream: true,
    },
    context.model,
  );
  const upstreamResponse = await createChatCompletion({
    baseUrl: context.baseUrl,
    body: {
      ...mapping.request,
      stream: true,
    },
    signal: context.signal,
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

        const deltaText = chunk.choices[0]?.delta?.content;
        if (deltaText) {
          yield {
            textDelta: deltaText,
            rawChunk: chunk,
          };
        }
      }

      resolveFinalResponse(
        mapLlamaCppChatCompletionToCanonicalResponse(
          request,
          mapping,
          aggregate,
        ),
      );
    } catch (error) {
      rejectFinalResponse(error);
      throw error;
    }
  })();

  return {
    deltas,
    finalResponse,
  };
};

export const llamaCppQwenBackend: BackendAdapter = {
  id: 'llamacpp-qwen-chatml',
  provider: 'llamacpp',
  chatTemplate: 'qwen',
  wireApi: 'chat-completions',
  execute: async (request, context) =>
    executeLlamaCppQwen(request, {
      baseUrl: context.config.llamaCppBaseUrl,
      model: context.config.llamaCppModel,
      signal: context.signal,
    }),
  stream: async (request, context) =>
    streamLlamaCppQwen(request, {
      baseUrl: context.config.llamaCppBaseUrl,
      model: context.config.llamaCppModel,
      signal: context.signal,
    }),
};

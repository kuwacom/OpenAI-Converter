import {
  createResponse as createUpstreamResponse,
  parseResponse,
  parseResponseStream,
} from '@/api/openai-compatible/v1/responses';
import { toCanonicalResponse } from '@/adapters/openai-responses/response-to-canonical';
import type { CanonicalRequest } from '@/models/canonical/response';
import type { OpenAIResponse } from '@/models/openai/responses';
import type { BackendAdapter, BackendStreamResult } from '@/types/backend';
import { HttpError } from '@/types/errors';

const toUpstreamRequest = (
  request: CanonicalRequest,
  backendModel?: string,
): Record<string, unknown> => ({
  ...request.raw,
  model: backendModel ?? request.model,
  background: false,
  stream: false,
});

export const executeOpenAICompatibleResponses = async (
  request: CanonicalRequest,
  context: { baseUrl?: string; model?: string; signal?: AbortSignal },
) => {
  if (!context.baseUrl) {
    throw new HttpError(
      500,
      'openai-compatible backend requires OPENAI_COMPATIBLE_BASE_URL',
    );
  }

  const upstreamResponse = await createUpstreamResponse({
    baseUrl: context.baseUrl,
    body: toUpstreamRequest(request, context.model),
    signal: context.signal,
  });
  const parsedResponse = await parseResponse(upstreamResponse);

  return toCanonicalResponse(request, parsedResponse);
};

export const streamOpenAICompatibleResponses = async (
  request: CanonicalRequest,
  context: { baseUrl?: string; model?: string; signal?: AbortSignal },
): Promise<BackendStreamResult> => {
  if (!context.baseUrl) {
    throw new HttpError(
      500,
      'openai-compatible backend requires OPENAI_COMPATIBLE_BASE_URL',
    );
  }

  const upstreamResponse = await createUpstreamResponse({
    baseUrl: context.baseUrl,
    body: {
      ...toUpstreamRequest(request, context.model),
      stream: true,
    },
    signal: context.signal,
  });

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
      for await (const event of parseResponseStream(upstreamResponse)) {
        if (
          event.type === 'response.output_text.delta' &&
          typeof event.delta === 'string'
        ) {
          yield {
            textDelta: event.delta,
            rawChunk: event,
          };
        }

        if (event.type === 'response.completed' && event.response) {
          resolveFinalResponse(
            toCanonicalResponse(request, event.response as OpenAIResponse),
          );
        }
      }
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

export const openAICompatibleResponsesBackend: BackendAdapter = {
  id: 'openai-compatible-responses',
  provider: 'openai-compatible',
  chatTemplate: 'none',
  wireApi: 'responses',
  execute: async (request, context) =>
    executeOpenAICompatibleResponses(request, {
      baseUrl: context.config.openAICompatibleBaseUrl,
      model: context.config.openAICompatibleModel,
      signal: context.signal,
    }),
  stream: async (request, context) =>
    streamOpenAICompatibleResponses(request, {
      baseUrl: context.config.openAICompatibleBaseUrl,
      model: context.config.openAICompatibleModel,
      signal: context.signal,
    }),
};

import {
  createResponse as createUpstreamResponse,
  parseResponse,
  parseResponseStream,
} from '@/apiClient/responsesClient';
import { toCanonicalResponse } from '@/adapters/upstreamResponseToCanonical';
import type { CanonicalRequest } from '@/models/canonical/response';
import type { OpenAIResponse } from '@/models/responsesModel';
import type { BackendAdapter, BackendStreamResult } from '@/types/backend';
import { HttpError } from '@/types/errors';
import { synthesizeCanonicalResponseOutputs } from '@/services/proxy/tooling';

type ExecuteContext = {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
};

// 上流がネイティブ Responses API を持つ場合の pass-through リクエスト。
// background フラグは proxy 側で管理するため送らない。model の上書きのみ行う
const toUpstreamRequest = (
  request: CanonicalRequest,
  backendModel?: string,
): Record<string, unknown> => ({
  ...request.raw,
  model: backendModel && backendModel.length > 0 ? backendModel : request.model,
  background: false,
});

export const executeOpenAICompatibleResponses = async (
  request: CanonicalRequest,
  context: ExecuteContext,
) => {
  if (!context.baseUrl) {
    throw new HttpError(
      500,
      'openai-compatible-responses backend requires UPSTREAM_BASE_URL',
    );
  }

  const upstreamResponse = await createUpstreamResponse({
    baseUrl: context.baseUrl,
    body: toUpstreamRequest(request, context.model),
    apiKey: context.apiKey,
  });
  const parsedResponse = await parseResponse(upstreamResponse);

  return synthesizeCanonicalResponseOutputs(
    toCanonicalResponse(request, parsedResponse),
    request.tools,
  );
};

export const streamOpenAICompatibleResponses = async (
  request: CanonicalRequest,
  context: ExecuteContext,
): Promise<BackendStreamResult> => {
  if (!context.baseUrl) {
    throw new HttpError(
      500,
      'openai-compatible-responses backend requires UPSTREAM_BASE_URL',
    );
  }

  const upstreamResponse = await createUpstreamResponse({
    baseUrl: context.baseUrl,
    body: { ...toUpstreamRequest(request, context.model), stream: true },
    apiKey: context.apiKey,
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

  // 上流 SSE イベントから text delta を抽出してクライアントへストリーミングする。
  // 最終的に response.completed を受信したら canonical へ変換して finalResponse を解決する
  const deltas = (async function* () {
    try {
      for await (const event of parseResponseStream(upstreamResponse)) {
        if (
          event.type === 'response.output_text.delta' &&
          typeof event.delta === 'string'
        ) {
          yield { textDelta: event.delta };
        }

        if (event.type === 'response.completed' && event.response) {
          resolveFinalResponse(
            synthesizeCanonicalResponseOutputs(
              toCanonicalResponse(request, event.response as OpenAIResponse),
              request.tools,
            ),
          );
        }
      }
    } catch (error) {
      rejectFinalResponse(error);
      throw error;
    }
  })();

  return { deltas, finalResponse };
};

export const openAICompatibleResponsesBackend: BackendAdapter = {
  id: 'openai-compatible-responses',
  provider: 'openai-compatible',
  wireApi: 'responses',
  execute: async (request, ctx) =>
    executeOpenAICompatibleResponses(request, {
      baseUrl: ctx.config.upstreamBaseUrl,
      model: ctx.config.upstreamModel || undefined,
      apiKey: ctx.config.upstreamApiKey || undefined,
    }),
  stream: async (request, ctx) =>
    streamOpenAICompatibleResponses(request, {
      baseUrl: ctx.config.upstreamBaseUrl,
      model: ctx.config.upstreamModel || undefined,
      apiKey: ctx.config.upstreamApiKey || undefined,
    }),
};

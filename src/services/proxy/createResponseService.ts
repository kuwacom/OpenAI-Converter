import type { AppConfig } from '@/types/env';
import type {
  CreateResponseRequest,
  OpenAIResponse,
} from '@/models/responsesModel';
import { toCanonicalRequest } from '@/adapters/requestToCanonical';
import {
  createInProgressOpenAIResponse,
  toOpenAIResponse,
} from '@/adapters/canonicalToResponse';
import { resolveBackend } from '@/services/backends/resolveBackend';
import { responseStore } from '@/services/proxy/responseStoreService';
import {
  buildStreamingEvents,
  sseEncode,
} from '@/services/proxy/sseEventBuilder';
import { createMessageId } from '@/lib/ids';

const extractCurrentInputItems = (request: CreateResponseRequest) => {
  if (typeof request.input === 'string') {
    return [request.input];
  }

  if (Array.isArray(request.input)) {
    return request.input;
  }

  return [];
};

const buildFailedResponse = (
  inProgressResponse: OpenAIResponse,
  error: unknown,
): OpenAIResponse => ({
  ...inProgressResponse,
  status: 'failed',
  completed_at: Math.floor(Date.now() / 1000),
  error: {
    message: error instanceof Error ? error.message : 'Unknown error',
    type: 'backend_error',
  },
});

const prepareExecution = (
  request: CreateResponseRequest,
  config: AppConfig,
) => {
  const previousContext = responseStore.getConversationContext(
    request.previous_response_id,
  );
  const canonicalRequest = toCanonicalRequest(request, previousContext);
  const backend = resolveBackend(canonicalRequest, config.defaultBackend);
  const currentInputItems = extractCurrentInputItems(request);

  return {
    backend,
    canonicalRequest,
    currentInputItems,
  };
};

export const createResponse = async (
  request: CreateResponseRequest,
  config: AppConfig,
): Promise<OpenAIResponse> => {
  const { backend, canonicalRequest, currentInputItems } = prepareExecution(
    request,
    config,
  );

  if (canonicalRequest.background) {
    const abortController = new AbortController();
    const inProgressResponse = createInProgressOpenAIResponse(canonicalRequest);

    responseStore.save({
      request,
      toolsRaw: request.tools ?? [],
      inputItems: currentInputItems,
      outputItems: [],
      response: inProgressResponse,
      abortController,
    });

    void (async () => {
      try {
        const canonicalResponse = await backend.execute(
          canonicalRequest,
          {
            config,
            signal: abortController.signal,
          },
          {
            // Responses API clients drive their own external tool execution loop.
            // サーバ側での偽結果合成ループは Codex 等では有害なため無効化する
            disableToolLoop: true,
          },
        );
        const finalResponse = toOpenAIResponse(
          canonicalRequest,
          canonicalResponse,
        );

        responseStore.updateResponse(canonicalRequest.id, finalResponse);
      } catch (error) {
        if (abortController.signal.aborted) {
          responseStore.cancel(canonicalRequest.id);
          return;
        }

        responseStore.updateResponse(
          canonicalRequest.id,
          buildFailedResponse(inProgressResponse, error),
        );
      }
    })();

    return inProgressResponse;
  }

  const canonicalResponse = await backend.execute(
    canonicalRequest,
    {
      config,
    },
    {
      // 同上。Responses API clients drive their own external tool execution loop.
      disableToolLoop: true,
    },
  );
  const finalResponse = toOpenAIResponse(canonicalRequest, canonicalResponse);

  responseStore.save({
    request,
    toolsRaw: request.tools ?? [],
    inputItems: currentInputItems,
    outputItems: finalResponse.output,
    response: finalResponse,
  });

  return finalResponse;
};

export const createStreamingResponse = async (
  request: CreateResponseRequest,
  config: AppConfig,
): Promise<Response> => {
  const { backend, canonicalRequest, currentInputItems } = prepareExecution(
    request,
    config,
  );
  const inProgressResponse = createInProgressOpenAIResponse(canonicalRequest);
  const abortController = new AbortController();
  const streamItemId = createMessageId();

  responseStore.save({
    request,
    toolsRaw: request.tools ?? [],
    inputItems: currentInputItems,
    outputItems: [],
    response: inProgressResponse,
    abortController,
  });

  const streamResult = backend.stream
    ? await backend.stream(canonicalRequest, {
        config,
        signal: abortController.signal,
      })
    : undefined;

  // codex-relay stream.rs 準拠のストリーミング実装:
  //   - response.created のみ送り、事前 output_item.added/content_part.added は送らない
  //   - reasoning delta 初回時 → output_item.added(reasoning) + reasoning_summary_text.delta 配信
  //   - text delta 初回時 → output_item.added(message) + content_part.added + output_text.delta 配信
  //   - 全 delta 完了後 → output_item.done(reasoning) + buildStreamingEvents(function_call等) + response.completed
  //   空メッセージ未完了アイテム残留防止のため、delta が来た時のみ動的に added を送る
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      let accumulatedText = '';
      let accumulatedReasoning = '';
      const reasoningItemId = `rs_${createMessageId()}`;
      let reasoningOutputIndex: number | null = null;
      let messageOutputIndex: number | null = null;
      const outputIndexCounter = { next: 0 };

      controller.enqueue(
        encoder.encode(
          sseEncode('response.created', {
            type: 'response.created',
            response: {
              id: canonicalRequest.id,
              status: 'in_progress',
              model: canonicalRequest.model,
            },
          }),
        ),
      );

      try {
        if (streamResult) {
          for await (const delta of streamResult.deltas) {
            if (delta.reasoningDelta) {
              if (reasoningOutputIndex === null) {
                reasoningOutputIndex = outputIndexCounter.next++;
                controller.enqueue(
                  encoder.encode(
                    sseEncode('response.output_item.added', {
                      type: 'response.output_item.added',
                      output_index: reasoningOutputIndex,
                      item: {
                        type: 'reasoning',
                        id: reasoningItemId,
                        summary: [{ type: 'summary_text', text: '' }],
                      },
                    }),
                  ),
                );
              }
              accumulatedReasoning += delta.reasoningDelta;
              controller.enqueue(
                encoder.encode(
                  sseEncode('response.reasoning_summary_text.delta', {
                    type: 'response.reasoning_summary_text.delta',
                    item_id: reasoningItemId,
                    output_index: reasoningOutputIndex,
                    summary_index: 0,
                    delta: delta.reasoningDelta,
                  }),
                ),
              );
            }

            if (!delta.textDelta) {
              continue;
            }

            if (messageOutputIndex === null) {
              messageOutputIndex = outputIndexCounter.next++;
              controller.enqueue(
                encoder.encode(
                  sseEncode('response.output_item.added', {
                    type: 'response.output_item.added',
                    output_index: messageOutputIndex,
                    item: {
                      id: streamItemId,
                      type: 'message',
                      status: 'in_progress',
                      role: 'assistant',
                      content: [],
                    },
                  }),
                ),
              );
              controller.enqueue(
                encoder.encode(
                  sseEncode('response.content_part.added', {
                    type: 'response.content_part.added',
                    item_id: streamItemId,
                    output_index: messageOutputIndex,
                    content_index: 0,
                    part: {
                      type: 'output_text',
                      text: '',
                      annotations: [],
                    },
                  }),
                ),
              );
            }

            accumulatedText += delta.textDelta;
            controller.enqueue(
              encoder.encode(
                sseEncode('response.output_text.delta', {
                  type: 'response.output_text.delta',
                  item_id: streamItemId,
                  output_index: messageOutputIndex!,
                  content_index: 0,
                  delta: delta.textDelta,
                }),
              ),
            );
          }
        }

        const canonicalResponse = streamResult
          ? await streamResult.finalResponse
          : await backend.execute(canonicalRequest, {
              config,
              signal: abortController.signal,
            });
        const finalResponse = toOpenAIResponse(
          canonicalRequest,
          canonicalResponse,
        );

        const firstMessageIndex = finalResponse.output.findIndex(
          (output: Record<string, unknown>) => output.type === 'message',
        );

        if (firstMessageIndex >= 0) {
          const firstMessage = finalResponse.output[firstMessageIndex];

          if (firstMessage?.type === 'message') {
            finalResponse.output[firstMessageIndex] = {
              ...firstMessage,
              id: streamItemId,
            };
          }
        }

        // codex-relay 準拠: ストリーム中に蓄積した reasoning があれば output_item.done(reasoning) を先に送信
        if (accumulatedReasoning && reasoningOutputIndex !== null) {
          controller.enqueue(
            encoder.encode(
              sseEncode('response.output_item.done', {
                type: 'response.output_item.done',
                output_index: reasoningOutputIndex,
                item: {
                  type: 'reasoning',
                  id: reasoningItemId,
                  summary: [
                    { type: 'summary_text', text: accumulatedReasoning },
                  ],
                },
              }),
            ),
          );
        }

        responseStore.updateResponse(canonicalRequest.id, finalResponse);

        for (const event of buildStreamingEvents(
          finalResponse,
          accumulatedText,
          streamItemId,
          {
            streamedReasoning:
              !!accumulatedReasoning && reasoningOutputIndex !== null,
            ...(messageOutputIndex !== null ? { messageOutputIndex } : {}),
            nextOutputIndex: outputIndexCounter.next,
          },
        )) {
          controller.enqueue(
            encoder.encode(sseEncode(event.event, event.data)),
          );
        }

        controller.close();
      } catch (error) {
        const isAborted =
          abortController.signal.aborted ||
          (error instanceof Error && error.name === 'AbortError');

        if (isAborted) {
          responseStore.cancel(canonicalRequest.id);
          try {
            controller.close();
          } catch {
            // 既に close 済みの場合は無視する
          }
          return;
        }

        const failedResponse = buildFailedResponse(inProgressResponse, error);
        responseStore.updateResponse(canonicalRequest.id, failedResponse);
        try {
          controller.enqueue(
            encoder.encode(
              sseEncode('response.failed', {
                type: 'response.failed',
                response: failedResponse,
              }),
            ),
          );
          controller.close();
        } catch {
          // クライアント切断で controller が無効化されている場合は無視する
        }
      }
    },
    cancel() {
      abortController.abort();
    },
  });

  return new Response(readable, {
    headers: {
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'content-type': 'text/event-stream; charset=utf-8',
    },
  });
};

export const getResponse = async (responseId: string) =>
  responseStore.getOrThrow(responseId).response;

export const cancelResponse = async (responseId: string) =>
  responseStore.cancel(responseId);

export const getResponseInputItems = async (responseId: string) => {
  const record = responseStore.getOrThrow(responseId);

  return {
    object: 'list',
    data: record.inputItems,
    first_id: null,
    last_id: null,
    has_more: false,
  };
};

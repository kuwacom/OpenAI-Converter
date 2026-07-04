import type { AppConfig } from '@/types/env';
import type {
  CreateResponseRequest,
  OpenAIResponse,
} from '@/models/responsesModel';
import { toCanonicalRequest } from '@/adapters/requestToCanonical';
import {
  createInProgressOpenAIResponse,
  createSyntheticAssistantMessageOutput,
  getAssistantTextFromResponse,
  toOpenAIResponse,
} from '@/adapters/canonicalToResponse';
import { resolveBackend } from '@/services/backends/resolveBackend';
import { responseStore } from '@/services/proxy/responseStoreService';
import { createMessageId } from '@/utils/ids';

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

const buildStreamingEvents = (
  finalResponse: OpenAIResponse,
  streamedText: string,
  itemId: string,
) => {
  const events: Array<{ event: string; data: Record<string, unknown> }> = [];

  const firstOutput = finalResponse.output.find(
    (item: Record<string, unknown>) => item.type === 'message',
  );
  const finalAssistantText =
    streamedText || getAssistantTextFromResponse(finalResponse);

  if (finalAssistantText) {
    events.push(
      {
        event: 'response.output_text.done',
        data: {
          type: 'response.output_text.done',
          item_id: itemId,
          output_index: 0,
          content_index: 0,
          text: finalAssistantText,
        },
      },
      {
        event: 'response.content_part.done',
        data: {
          type: 'response.content_part.done',
          item_id: itemId,
          output_index: 0,
          content_index: 0,
          part: {
            type: 'output_text',
            text: finalAssistantText,
            annotations: [],
          },
        },
      },
      {
        event: 'response.output_item.done',
        data: {
          type: 'response.output_item.done',
          output_index: 0,
          item:
            firstOutput && firstOutput.type === 'message'
              ? firstOutput
              : {
                  ...createSyntheticAssistantMessageOutput(finalAssistantText),
                  id: itemId,
                },
        },
      },
    );
  }

  finalResponse.output
    .filter((output) => !(finalAssistantText && output.type === 'message'))
    .forEach((output: Record<string, unknown>, outputIndex: number) => {
      events.push(
        {
          event: 'response.output_item.added',
          data: {
            type: 'response.output_item.added',
            output_index: outputIndex + (finalAssistantText ? 1 : 0),
            item: output,
          },
        },
        {
          event: 'response.output_item.done',
          data: {
            type: 'response.output_item.done',
            output_index: outputIndex + (finalAssistantText ? 1 : 0),
            item: output,
          },
        },
      );
    });

  if (!finalAssistantText && finalResponse.output.length === 0) {
    events.push({
      event: 'response.output_item.done',
      data: {
        type: 'response.output_item.done',
        output_index: 0,
        item: createSyntheticAssistantMessageOutput(''),
      },
    });
  }

  events.push({
    event: 'response.completed',
    data: {
      type: 'response.completed',
      response: finalResponse,
    },
  });

  return events;
};

const sseEncode = (event: string, data: Record<string, unknown>) =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

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
            disableToolLoop: false,
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
      disableToolLoop: false,
    },
  );
  const finalResponse = toOpenAIResponse(canonicalRequest, canonicalResponse);

  responseStore.save({
    request,
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

  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      let accumulatedText = '';

      controller.enqueue(
        encoder.encode(
          sseEncode('response.created', {
            type: 'response.created',
            response: inProgressResponse,
          }),
        ),
      );
      controller.enqueue(
        encoder.encode(
          sseEncode('response.in_progress', {
            type: 'response.in_progress',
            response: inProgressResponse,
          }),
        ),
      );
      controller.enqueue(
        encoder.encode(
          sseEncode('response.output_item.added', {
            type: 'response.output_item.added',
            output_index: 0,
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
            output_index: 0,
            content_index: 0,
            part: {
              type: 'output_text',
              text: '',
              annotations: [],
            },
          }),
        ),
      );

      try {
        if (streamResult) {
          for await (const delta of streamResult.deltas) {
            if (!delta.textDelta) {
              continue;
            }

            accumulatedText += delta.textDelta;
            controller.enqueue(
              encoder.encode(
                sseEncode('response.output_text.delta', {
                  type: 'response.output_text.delta',
                  item_id: streamItemId,
                  output_index: 0,
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

        responseStore.updateResponse(canonicalRequest.id, finalResponse);

        for (const event of buildStreamingEvents(
          finalResponse,
          accumulatedText,
          streamItemId,
        )) {
          controller.enqueue(
            encoder.encode(sseEncode(event.event, event.data)),
          );
        }

        controller.close();
      } catch (error) {
        const failedResponse = buildFailedResponse(inProgressResponse, error);
        responseStore.updateResponse(canonicalRequest.id, failedResponse);
        controller.enqueue(
          encoder.encode(
            sseEncode('response.failed', {
              type: 'response.failed',
              response: failedResponse,
            }),
          ),
        );
        controller.close();
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

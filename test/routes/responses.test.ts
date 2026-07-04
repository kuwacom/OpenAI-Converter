import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/proxy/createResponseService', () => ({
  createResponse: vi.fn(),
  createStreamingResponse: vi.fn(),
  getResponse: vi.fn(),
  cancelResponse: vi.fn(),
  getResponseInputItems: vi.fn(),
}));

import { createApp } from '@/app';
import {
  createResponse,
  createStreamingResponse,
} from '@/services/proxy/createResponseService';
import { ResponseSchema } from '@/schemas/responsesSchema';

const baseResponse = ResponseSchema.parse({
  id: 'resp-test',
  object: 'response',
  created_at: 1,
  completed_at: 2,
  status: 'completed',
  background: false,
  error: null,
  incomplete_details: null,
  instructions: null,
  max_output_tokens: null,
  max_tool_calls: null,
  model: 'qwen3.5',
  output: [],
  parallel_tool_calls: true,
  previous_response_id: null,
  reasoning: {
    effort: null,
    summary: null,
  },
  service_tier: undefined,
  store: true,
  temperature: 1,
  text: {
    format: {
      type: 'text',
    },
  },
  tool_choice: 'none',
  tools: [],
  top_p: 1,
  truncation: 'disabled',
  usage: null,
  user: null,
  metadata: {},
});

const responseWithToolItems = ResponseSchema.parse({
  ...baseResponse,
  output: [
    {
      id: 'rs_1',
      type: 'reasoning',
      status: 'completed',
      summary: [{ type: 'summary_text', text: 'Need to call a tool first.' }],
      encrypted_content: null,
    },
    {
      id: 'fc_1',
      type: 'function_call',
      call_id: 'call_1',
      name: 'lookup_info',
      arguments: '{"topic":"mars"}',
      status: 'completed',
    },
  ],
});

describe('responses routes', () => {
  const app = createApp();
  const mockedCreateResponse = vi.mocked(createResponse);
  const mockedCreateStreamingResponse = vi.mocked(createStreamingResponse);

  beforeEach(() => {
    mockedCreateResponse.mockReset();
    mockedCreateStreamingResponse.mockReset();
  });

  it('returns the non-stream response payload', async () => {
    mockedCreateResponse.mockResolvedValue(baseResponse);

    const response = await app.request(
      new Request('http://localhost/v1/responses', {
        method: 'POST',
        body: JSON.stringify({
          model: 'qwen3.5',
          input: 'Hello',
        }),
        headers: {
          'content-type': 'application/json',
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(baseResponse);
  });

  it('proxies streaming responses when stream flag is true', async () => {
    const streamingResponse = new Response(
      'event: response.completed\ndata: {"status":"ok"}\n\n',
      {
        headers: {
          'content-type': 'text/event-stream; charset=utf-8',
        },
      },
    );

    mockedCreateStreamingResponse.mockResolvedValue(streamingResponse);

    const response = await app.request(
      new Request('http://localhost/v1/responses', {
        method: 'POST',
        body: JSON.stringify({
          model: 'qwen3.5',
          stream: true,
        }),
        headers: {
          'content-type': 'application/json',
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(await response.text()).toContain('response.completed');
  });

  it('returns 202 for background responses', async () => {
    const backgroundResponse = {
      ...baseResponse,
      background: true,
      status: 'in_progress',
    };

    mockedCreateResponse.mockResolvedValue(backgroundResponse);

    const response = await app.request(
      new Request('http://localhost/v1/responses', {
        method: 'POST',
        body: JSON.stringify({
          model: 'qwen3.5',
          background: true,
        }),
        headers: {
          'content-type': 'application/json',
        },
      }),
    );

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual(backgroundResponse);
    const firstCall = mockedCreateResponse.mock.calls[0];

    expect(firstCall).toBeDefined();

    if (!firstCall) {
      throw new Error('Expected createResponse to be called');
    }

    const [payload] = firstCall;
    expect(payload.background).toBe(true);
  });

  it('returns reasoning and function call output items', async () => {
    mockedCreateResponse.mockResolvedValue(responseWithToolItems);

    const response = await app.request(
      new Request('http://localhost/v1/responses', {
        method: 'POST',
        body: JSON.stringify({
          model: 'qwen3.5',
          input: 'Hello',
          tools: [
            {
              type: 'function',
              name: 'lookup_info',
              description: 'Lookup information',
              parameters: {
                type: 'object',
                properties: {
                  topic: { type: 'string' },
                },
              },
            },
          ],
        }),
        headers: {
          'content-type': 'application/json',
        },
      }),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.output).toHaveLength(2);
    expect(payload.output[0]).toMatchObject({
      type: 'reasoning',
      status: 'completed',
    });
    expect(payload.output[1]).toMatchObject({
      type: 'function_call',
      name: 'lookup_info',
      call_id: 'call_1',
    });
  });
});

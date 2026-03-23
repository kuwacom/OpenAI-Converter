import { describe, expect, it } from 'vitest';
import { toCanonicalRequest } from '@/adapters/openai-responses/request-to-canonical';
import { mapCanonicalRequestToLlamaCppQwenRequest } from '@/backends/llamacpp/qwen/request-mapper';
import { CreateResponseRequestSchema } from '@/schemas/openai/responses';

describe('llama.cpp request mapper', () => {
  it('maps native function tools using the nested OpenAI-compatible tool shape', () => {
    const request = CreateResponseRequestSchema.parse({
      model: 'qwen3.5',
      input: 'Run ls',
      tools: [
        {
          type: 'function',
          name: 'shell',
          description: 'Run a command',
          parameters: {
            type: 'object',
            properties: {
              command: {
                type: 'array',
                items: {
                  type: 'string',
                },
              },
            },
            required: ['command'],
          },
        },
      ],
    });

    const canonicalRequest = toCanonicalRequest(request);
    const mapped = mapCanonicalRequestToLlamaCppQwenRequest(canonicalRequest);

    expect(mapped.nativeToolMode).toBe(true);
    expect(mapped.request.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'shell',
          description: 'Run a command',
          parameters: {
            type: 'object',
            properties: {
              command: {
                type: 'array',
                items: {
                  type: 'string',
                },
              },
            },
            required: ['command'],
          },
          strict: true,
        },
      },
    ]);
  });
});

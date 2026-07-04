import { describe, expect, it } from 'vitest';
import { toCanonicalRequest } from '@/adapters/requestToCanonical';
import { CreateResponseRequestSchema } from '@/schemas/responsesSchema';

describe('request-to-canonical adapter', () => {
  it('captures instructions and tool calls consistently', () => {
    const createRequest = {
      model: 'qwen3.5',
      instructions: 'You are a helpful assistant.',
      input: [
        'plain text message',
        {
          role: 'user',
          content: [{ type: 'input_text', text: 'Please fetch data.' }],
        },
        {
          type: 'function_call',
          name: 'lookup_info',
          arguments: JSON.stringify({ topic: 'planets' }),
        },
      ],
      tools: [
        {
          type: 'function',
          name: 'lookup_info',
          description: 'Return reference material.',
          parameters: {
            type: 'object',
            properties: {
              topic: {
                type: 'string',
              },
            },
            required: ['topic'],
          },
          strict: true,
        },
      ],
      reasoning: {
        effort: 'low',
      },
      tool_choice: 'auto',
      include: ['message.output_text.logprobs'],
    };

    const canonical = toCanonicalRequest(
      CreateResponseRequestSchema.parse(createRequest),
    );

    expect(canonical.instructions).toBe('You are a helpful assistant.');
    expect(canonical.tools).toHaveLength(1);
    expect(canonical.include).toContain('message.output_text.logprobs');
    const assistantMessage = canonical.messages.find(
      (message) => message.role === 'assistant',
    );
    expect(assistantMessage).toBeDefined();
    const toolCall = assistantMessage?.toolCalls?.[0];
    expect(toolCall?.name).toBe('lookup_info');
    expect(toolCall?.arguments).toEqual({ topic: 'planets' });
    const userMessage = canonical.messages.find(
      (message) => message.role === 'user',
    );
    expect(userMessage?.content.some((part) => part.type === 'text')).toBe(
      true,
    );
  });

  it('accepts null for optional fields that Codex may send', () => {
    const parsedRequest = CreateResponseRequestSchema.parse({
      model: 'qwen3.5',
      input: 'Hello',
      reasoning: null,
      tools: null,
      include: null,
      metadata: null,
      text: null,
      conversation: null,
      stream: null,
      background: null,
    });

    expect(parsedRequest.reasoning).toBeUndefined();
    expect(parsedRequest.tools).toEqual([]);
    expect(parsedRequest.include).toEqual([]);
    expect(parsedRequest.metadata).toEqual({});
    expect(parsedRequest.text).toBeUndefined();
    expect(parsedRequest.stream).toBe(false);
    expect(parsedRequest.background).toBe(false);
  });
});

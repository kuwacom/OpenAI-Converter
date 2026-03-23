import { describe, expect, it } from 'vitest';
import { parseQwenResponseContent } from '@/adapters/chat-templates/qwen/parse';
import { renderQwenChatTemplate } from '@/adapters/chat-templates/qwen/render';
import { toCanonicalRequest } from '@/adapters/openai-responses/request-to-canonical';
import { CreateResponseRequestSchema } from '@/schemas/openai/responses';

describe('Qwen chat template rendering', () => {
  it('embeds tool calls into assistant output and exposes user text', () => {
    const canonicalRequest = toCanonicalRequest(
      CreateResponseRequestSchema.parse({
        model: 'qwen3.5',
        instructions: 'Act as historian.',
        input: [
          {
            role: 'user',
            content: [{ type: 'input_text', text: 'Tell me about Mars.' }],
          },
          {
            type: 'function_call',
            name: 'fetch_history',
            arguments: JSON.stringify({ topic: 'Mars' }),
          },
        ],
        tools: [
          {
            type: 'function',
            name: 'fetch_history',
            description: 'Retrieve historical notes.',
            parameters: {
              type: 'object',
              properties: {
                topic: { type: 'string' },
              },
              required: ['topic'],
            },
            strict: true,
          },
        ],
      }),
    );

    const { messages } = renderQwenChatTemplate(canonicalRequest, true);

    const systemMessage = messages.find((message) => message.role === 'system');
    expect(systemMessage?.content).toContain('Act as historian');

    const assistantMessage = messages.find(
      (message) => message.role === 'assistant',
    );
    expect(assistantMessage?.content).toContain('<tool_call>');
    expect(assistantMessage?.content).toContain('fetch_history');

    const userMessage = messages.find((message) => message.role === 'user');
    expect(userMessage?.content).toContain('Tell me about Mars.');
  });

  it('parses qwen reasoning and tool call tags', () => {
    const parsed = parseQwenResponseContent(`
<think>
Need to call the tool first.
</think>
<tool_call>
{"name":"fetch_history","arguments":{"topic":"Mars"}}
</tool_call>
`);

    expect(parsed.reasoningText).toContain('Need to call the tool first');
    expect(parsed.toolCalls).toHaveLength(1);
    expect(parsed.toolCalls[0]?.name).toBe('fetch_history');
    expect(parsed.toolCalls[0]?.arguments).toEqual({ topic: 'Mars' });
  });
});

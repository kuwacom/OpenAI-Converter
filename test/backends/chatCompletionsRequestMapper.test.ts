import { describe, expect, it } from 'vitest';
import {
  mapToChatCompletions,
  buildChatCompletionTools,
  toChatCompletionMessages,
} from '@/backends/chatCompletionsRequestMapper';
import { toCanonicalRequest } from '@/adapters/requestToCanonical';
import { CreateResponseRequestSchema } from '@/schemas/responsesSchema';

describe('chat-completions request mapper', () => {
  it('forwards function tools with the nested OpenAI tool shape', () => {
    const request = CreateResponseRequestSchema.parse({
      model: 'gpt-4o-mini',
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
                items: { type: 'string' },
              },
            },
            required: ['command'],
          },
        },
      ],
    });

    const canonicalRequest = toCanonicalRequest(request);
    const mapped = mapToChatCompletions(canonicalRequest);
    const firstTool = mapped.request.tools?.[0];

    // 上流 CC API 向け正規化形状を検証する。
    // strict はプロバイダ依存で省略され得るため主要フィールドで比較する
    expect(firstTool).toMatchObject({
      type: 'function',
      function: {
        name: 'shell',
        description: 'Run a command',
        parameters: {
          type: 'object',
          properties: {
            command: {
              type: 'array',
              items: { type: 'string' },
            },
          },
          required: ['command'],
        },
      },
    });
  });

  it('wraps non-function tools into a single-input function tool', () => {
    const request = CreateResponseRequestSchema.parse({
      model: 'm1',
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
      tools: [
        {
          type: 'custom',
          name: 'write_memory',
          description: 'freeform memory writer',
        },
      ],
    });

    const mapped = mapToChatCompletions(toCanonicalRequest(request));
    expect(mapped.request.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'write_memory',
          description: 'freeform memory writer',
          parameters: {
            type: 'object',
            properties: {
              input: {
                type: 'string',
                description: `Freeform payload for write_memory`,
              },
            },
            required: ['input'],
          },
        },
      },
    ]);
  });

  it('maps assistant tool_calls + tool result into the openai multi-turn form', () => {
    const request = CreateResponseRequestSchema.parse({
      model: 'gpt-4o-mini',
      input: [
        {
          role: 'user',
          content: [{ type: 'input_text', text: 'lookup mars' }],
        },
        {
          type: 'function_call',
          call_id: 'call_1',
          name: 'lookup_info',
          arguments: JSON.stringify({ topic: 'mars' }),
        },
        {
          type: 'function_call_output',
          call_id: 'call_1',
          output: '{"ok":true}',
        },
      ],
      tools: [
        {
          type: 'function',
          name: 'lookup_info',
          parameters: { type: 'object', properties: {} },
        },
      ],
    });

    const canonical = toCanonicalRequest(request);
    const messages = toChatCompletionMessages(canonical.messages);

    // user / assistant(tool_calls) / tool 三連が順序を保ったまま残る
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool']);

    const assistant = messages.find((m) => m.role === 'assistant')!;
    expect(assistant.tool_calls?.[0]).toMatchObject({
      id: 'call_1',
      type: 'function',
      function: {
        name: 'lookup_info',
        arguments: JSON.stringify({ topic: 'mars' }),
      },
    });

    const toolMessage = messages.find((m) => m.role === 'tool')!;
    expect(toolMessage.tool_call_id).toBe('call_1');
  });

  it('passes reasoning effort through as reasoning_effort when present', () => {
    const request = CreateResponseRequestSchema.parse({
      model: 'deepseek-reasoner',
      input: 'plan a build',
      reasoning: { effort: 'high' },
    });
    const mapped = mapToChatCompletions(toCanonicalRequest(request));
    expect(mapped.request.reasoning_effort).toBe('high');
  });

  it('exposes helper exports without throwing on empty tools', () => {
    expect(buildChatCompletionTools([])).toEqual([]);
  });
});

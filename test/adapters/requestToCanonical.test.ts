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


import { CanonicalResponseSchema } from '@/schemas/responseSchema';
import { toOpenAIResponse } from '@/adapters/canonicalToResponse';
import type { CanonicalResponse, CanonicalRequest } from '@/models/canonical/response';

describe('request-to-canonical adapter namespace tools', () => {
  it('flattens {type:"namespace", tools:[...]} into per-child function tools', () => {
    const createRequest = {
      model: 'qwen3.5',
      input: [
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] },
      ],
      tools: [
        { type: 'function', name: 'top_level', parameters: { type: 'object', properties: {}, required: [] } },
        {
          type: 'namespace',
          name: 'mcp__codex_apps__github',
          description: 'GitHub MCP plugin',
          tools: [
            {
              type: 'function',
              name: '_add_comment_to_issue',
              description: 'Add a comment.',
              strict: false,
              parameters: {
                type: 'object',
                properties: { pr_number: { type: 'integer' }, comment: { type: 'string' } },
                required: ['pr_number', 'comment'],
              },
            },
            {
              type: 'function',
              name: '_close_issue',
              description: 'Close an issue.',
              strict: false,
              parameters: {
                type: 'object',
                properties: { issue_number: { type: 'integer' } },
                required: ['issue_number'],
              },
            },
          ],
        },
      ],
    };

    const canonical = toCanonicalRequest(
      CreateResponseRequestSchema.parse(createRequest),
    );

    expect(canonical.tools).toHaveLength(3);
    // トップレベル関数は wireName 単独、parentNamespace なし
    const top = canonical.tools[0];
    if (!top) { throw new Error('missing top'); }
    expect(top.name).toBe('top_level');
    expect(top.wireName).toBe('top_level');
    expect(top.parentNamespace).toBeUndefined();
    // namespace 子は wireName=`${ns}${childName}` 形式(codex mcp__server__tool 慣習に準拠)
    const childA = canonical.tools[1];
    if (!childA) { throw new Error('missing childA'); }
    expect(childA.name).toBe('_add_comment_to_issue');
    expect(childA.wireName).toBe('mcp__codex_apps__github_add_comment_to_issue');
    expect(childA.parentNamespace).toBe('mcp__codex_apps__github');
    // 子自体の parameters/strict は子の型宣言優先で保持される
    expect(childA.strict).toBe(false);
    expect(
      (childA.parameters?.properties as Record<string, unknown>)?.comment,
    ).toBeDefined();
    // 二番目の子も同様
    const childB = canonical.tools[2];
    if (!childB) { throw new Error('missing childB'); }
    expect(childB.name).toBe('_close_issue');
    expect(childB.wireName).toBe('mcp__codex_apps__github_close_issue');
  });

  it('restores namespace field when emitting function_call via canonicalToResponse', () => {
    const request: CanonicalRequest = toCanonicalRequest(
      CreateResponseRequestSchema.parse({
        model: 'qwen3.5',
        input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
        tools: [
          {
            type: 'namespace',
            name: 'ns_x',
            tools: [{ type: 'function', name: 'op_a', parameters: {} }],
          },
        ],
      }),
    );

    const responseInput = {
      id: request.id,
      object: 'response' as const,
      createdAt: Math.floor(Date.now() / 1000),
      completedAt: Math.floor(Date.now() / 1000),
      status: 'completed',
      model: request.model,
      output: [
        {
          kind: 'tool_call' as const,
          id: 'fc_a_00',
          status: 'completed',
          toolCall: {
            id: 'fc_a',
            callId: 'call_a',
            type: 'function' as const,
            name: 'op_a',
            wireName: 'ns_x-op_a',
            parentNamespace: 'ns_x',
            arguments: { x: '1' },
            originalType: 'function_call',
            status: 'completed',
          },
        },
      ],
    };
    const response: CanonicalResponse =
      CanonicalResponseSchema.parse(responseInput);

    const openaiResponse = toOpenAIResponse(request, response);
    const fcItem = openaiResponse.output.find((item) => item.type === 'function_call') as
      | Record<string, unknown>
      | undefined;

    expect(fcItem).toBeDefined();
    // Responses 形式 function_call へ namespace フィールドが復元されていること
    expect(fcItem?.namespace).toBe('ns_x');
    expect(fcItem?.name).toBe('op_a');
  });
});

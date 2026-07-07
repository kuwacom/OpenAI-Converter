import { describe, expect, it } from 'vitest';
import {
  buildStreamingEvents,
  sseEncode,
} from '@/services/proxy/sseEventBuilder';
import type { OpenAIResponse } from '@/models/responsesModel';

const eventNames = (events: ReturnType<typeof buildStreamingEvents>) =>
  events.map((e) => e.event);

const buildResponse = (output: Record<string, unknown>[]): OpenAIResponse =>
  ({
    id: 'resp_1',
    object: 'response' as const,
    status: 'completed',
    model: 'test-model',
    output,
  }) as unknown as OpenAIResponse;

// codex-rs/codex-api/src/sse/responses.rs および codex-rs/core/tests/common/responses.rs
// テストヘルパ(ev_function_call/ev_assistant_message)に基づく:
// function_call は output_item.done 単体で item 全体を配信すればよい。
// function_call_arguments.delta/done は codex CLI が未処理(_ => trace! unhandled)のため不要
describe('buildStreamingEvents function_call delivery (codex CLI 公式形式)', () => {
  it('emits output_item.done with full function_call item', () => {
    const args = JSON.stringify({ query: 'hello' });
    const response = buildResponse([
      {
        id: 'fc_1',
        type: 'function_call',
        call_id: 'call_1',
        name: 'search',
        namespace: 'mcp__my_server__',
        arguments: args,
        status: 'completed',
      },
    ]);

    const events = buildStreamingEvents(response, '', 'msg_item');
    const names = eventNames(events);

    expect(names).toEqual(['response.output_item.done', 'response.completed']);

    const done = events.find((e) => e.event === 'response.output_item.done');
    expect(done?.data.item).toMatchObject({
      type: 'function_call',
      status: 'completed',
      name: 'search',
      namespace: 'mcp__my_server__',
      call_id: 'call_1',
      arguments: args,
    });
  });

  it('preserves restored namespace field on function_call item', () => {
    const response = buildResponse([
      {
        id: 'fc_ns',
        type: 'function_call',
        call_id: 'call_ns',
        name: 'search',
        namespace: 'mcp__codex_apps__github',
        arguments: '{}',
        status: 'completed',
      },
    ]);

    const events = buildStreamingEvents(response, '', 'msg_item');
    const done = events.find((e) => e.event === 'response.output_item.done');
    expect(done?.data.item).toMatchObject({
      namespace: 'mcp__codex_apps__github',
      name: 'search',
    });
  });

  it('does not emit any delta/done sub-events for function_call', () => {
    const response = buildResponse([
      {
        id: 'fc_2',
        type: 'function_call',
        call_id: 'call_2',
        name: 'noop',
        arguments: '',
        status: 'completed',
      },
    ]);

    const events = buildStreamingEvents(response, '', 'msg_item');
    expect(
      events.some((e) =>
        e.event.startsWith('response.function_call_arguments'),
      ),
    ).toBe(false);
  });

  it('delivers message + function_call items in correct order when both present', () => {
    const response = buildResponse([
      {
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'calling tool' }],
        status: 'completed',
      },
      {
        id: 'fc_3',
        type: 'function_call',
        call_id: 'call_3',
        name: 'find_symbol',
        arguments: JSON.stringify({ symbol_path: 'test' }),
        status: 'completed',
      },
    ]);

    const events = buildStreamingEvents(response, 'calling tool', 'msg_1');
    const doneItems = events.filter(
      (e) => e.event === 'response.output_item.done',
    );

    const firstItem = doneItems[0]?.data.item as Record<string, unknown>;
    const secondItem = doneItems[1]?.data.item as Record<string, unknown>;
    expect(firstItem?.type).toBe('message');
    expect(secondItem?.type).toBe('function_call');
  });
});

describe('buildStreamingEvents custom_tool_call delivery', () => {
  it('emits output_item.done for custom_tool_call without input.delta/done', () => {
    const patchText =
      '*** Begin Patch\n*** Add File: foo.txt\n+hello\n*** End Patch';
    const response = buildResponse([
      {
        id: 'cu_1',
        type: 'custom_tool_call',
        call_id: 'call_cu',
        name: 'apply_patch',
        input: patchText,
        status: 'completed',
      },
    ]);

    const events = buildStreamingEvents(response, '', 'msg_item');

    expect(events.some((e) => e.event.includes('custom_tool_call_input'))).toBe(
      false,
    );

    const done = events.find((e) => e.event === 'response.output_item.done');
    expect(done?.data.item).toMatchObject({
      type: 'custom_tool_call',
      name: 'apply_patch',
      input: patchText,
      status: 'completed',
    });
  });
});

describe('buildStreamingEvents non-tool items', () => {
  it('preserves default message index for direct streamedReasoning calls', () => {
    const response = buildResponse([
      {
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'done' }],
        status: 'completed',
      },
      {
        id: 'fc_1',
        type: 'function_call',
        call_id: 'call_1',
        name: 'finish',
        arguments: '{}',
        status: 'completed',
      },
    ]);

    const events = buildStreamingEvents(response, 'done', 'msg_1', {
      streamedReasoning: true,
    });
    const outputTextDone = events.find(
      (event) => event.event === 'response.output_text.done',
    );
    const functionCallDone = events.find(
      (event) =>
        event.event === 'response.output_item.done' &&
        (event.data.item as Record<string, unknown> | undefined)?.type ===
          'function_call',
    );

    expect(outputTextDone?.data.output_index).toBe(0);
    expect(functionCallDone?.data.output_index).toBe(2);
  });

  it('keeps message done events on the streamed message index after reasoning', () => {
    const response = buildResponse([
      {
        id: 'rs_1',
        type: 'reasoning',
        summary: [{ type: 'summary_text', text: 'thinking' }],
        status: 'completed',
      },
      {
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'done' }],
        status: 'completed',
      },
      {
        id: 'fc_1',
        type: 'function_call',
        call_id: 'call_1',
        name: 'finish',
        arguments: '{}',
        status: 'completed',
      },
    ]);

    const events = buildStreamingEvents(response, 'done', 'msg_1', {
      streamedReasoning: true,
      messageOutputIndex: 1,
      nextOutputIndex: 2,
    });
    const messageDoneEvents = events.filter(
      (event) =>
        event.event === 'response.output_text.done' ||
        event.event === 'response.content_part.done' ||
        (event.event === 'response.output_item.done' &&
          (event.data.item as Record<string, unknown> | undefined)?.type ===
            'message'),
    );
    const functionCallDone = events.find(
      (event) =>
        event.event === 'response.output_item.done' &&
        (event.data.item as Record<string, unknown> | undefined)?.type ===
          'function_call',
    );

    expect(messageDoneEvents.map((event) => event.data.output_index)).toEqual([
      1, 1, 1,
    ]);
    expect(functionCallDone?.data.output_index).toBe(2);
  });

  it('emits single output_item.done for web_search_call', () => {
    const response = buildResponse([
      {
        id: 'ws_1',
        type: 'web_search_call',
        status: 'completed',
        action: { type: 'search', query: 'hello' },
      },
    ]);

    const events = buildStreamingEvents(response, '', 'msg_item');
    expect(
      events.filter((e) => e.event === 'response.output_item.done'),
    ).toHaveLength(1);
    expect(
      events.some(
        (e) => e.event.endsWith('.delta') && e.event.includes('arguments'),
      ),
    ).toBe(false);
  });
});

describe('buildStreamingEvents empty response handling', () => {
  it('emits synthetic assistant message for completely empty output', () => {
    const response = buildResponse([]);

    const events = buildStreamingEvents(response, '', 'msg_x');
    const doneItems = events.filter(
      (e) => e.event === 'response.output_item.done',
    );
    expect(doneItems.length).toBeGreaterThanOrEqual(1);
  });
});

describe('sseEncode format integration smoke', () => {
  it('encodes a single SSE event with proper event/data/newline framing', () => {
    const encoded = sseEncode('response.created', {
      type: 'response.created',
    });
    expect(encoded.startsWith('event: response.created')).toBe(true);
  });
});

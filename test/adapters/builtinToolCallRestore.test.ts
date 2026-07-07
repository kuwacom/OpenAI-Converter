import { describe, expect, it } from 'vitest';
import type { CanonicalRequest, CanonicalResponse } from '@/models/canonical/response';
import { toOpenAIResponse } from '@/adapters/canonicalToResponse';

// tool_search_call / local_shell_call 出力アイテム復元ロジックの検証。
// codex-rs/protocol/src/models.rs の ToolSearchCall / LocalShellCall 形状と整合するか確認する
describe('builtin tool_search_call / local_shell_call output restoration', () => {
  const baseRequest = {
    id: 'resp_test',
    model: 'gpt-5.4',
    messages: [],
    tools: [],
    originalToolsRaw: [],
    parallelToolCalls: true,
    stream: false,
    background: false,
    include: [],
    metadata: {},
    truncation: 'disabled',
    raw: {},
  } as unknown as CanonicalRequest;

  const buildResponse = (output: unknown[]): CanonicalResponse =>
    ({
      id: 'resp_1',
      object: 'response' as const,
      createdAt: 0,
      status: 'completed',
      model: 'gpt-5.4',
      output,
      reasoning: undefined,
      usage: undefined,
      error: null,
      incompleteDetails: null,
      instructions: null,
      maxOutputTokens: null,
      maxToolCalls: null,
      parallelToolCalls: true,
      previousResponseId: null,
      serviceTier: undefined,
      store: undefined,
      temperature: null,
      toolChoice: undefined,
      tools: [],
      topP: null,
      truncation: 'disabled',
      user: null,
      metadata: {},
      include: [],
    }) as unknown as CanonicalResponse;

  it('restores tool_search_call with execution separated from arguments', () => {
    const response = buildResponse([
      {
        kind: 'tool_call',
        id: 'tsc_1',
        status: 'completed',
        toolCall: {
          id: 'fc_1',
          callId: 'call_ts1',
          type: 'builtin',
          name: 'tool_search',
          wireName: 'tool_search',
          builtinKind: 'tool_search',
          arguments: { execution: 'client', query: 'calendar create', limit: 3 },
          rawArguments: JSON.stringify({ execution: 'client', query: 'calendar create', limit: 3 }),
          originalType: 'function_call',
          status: 'completed',
          raw: {},
        },
      },
    ]);

    const result = toOpenAIResponse(baseRequest, response);
    const item = result.output[0] as Record<string, unknown>;

    expect(item.type).toBe('tool_search_call');
    expect(item.call_id).toBe('call_ts1');
    expect(item.status).toBe('completed');
    // execution はトップレベルフィールドへ抽出される
    expect(item.execution).toBe('client');
    // arguments からは execution が除外されている(重複回避)
    const args = item.arguments as Record<string, unknown>;
    expect(args.execution).toBeUndefined();
    expect(args.query).toBe('calendar create');
    expect(args.limit).toBe(3);
  });

  it('defaults execution to "search" when not provided by upstream', () => {
    const response = buildResponse([
      {
        kind: 'tool_call',
        id: 'tsc_2',
        status: 'completed',
        toolCall: {
          id: 'fc_2',
          callId: 'call_ts2',
          type: 'builtin',
          name: 'tool_search',
          wireName: 'tool_search',
          builtinKind: 'tool_search',
          arguments: { query: 'find tools' },
          rawArguments: JSON.stringify({ query: 'find tools' }),
          originalType: 'function_call',
          status: 'completed',
          raw: {},
        },
      },
    ]);

    const result = toOpenAIResponse(baseRequest, response);
    const item = result.output[0] as Record<string, unknown>;

    expect(item.execution).toBe('search');
    expect((item.arguments as Record<string, unknown>).query).toBe('find tools');
  });

  it('restores local_shell_call action with exec type guaranteed', () => {
    const shellAction = {
      command: ['ls', '-la'],
      working_directory: '/tmp',
      timeout_ms: 5000,
    };
    const response = buildResponse([
      {
        kind: 'tool_call',
        id: 'lsc_1',
        status: 'completed',
        toolCall: {
          id: 'fc_3',
          callId: 'call_ls1',
          type: 'builtin',
          name: 'local_shell',
          wireName: 'local_shell',
          builtinKind: 'local_shell',
          arguments: { action: shellAction },
          rawArguments: JSON.stringify({ action: shellAction }),
          originalType: 'function_call',
          status: 'completed',
          raw: {},
        },
      },
    ]);

    const result = toOpenAIResponse(baseRequest, response);
    const item = result.output[0] as Record<string, unknown>;

    expect(item.type).toBe('local_shell_call');
    expect(item.call_id).toBe('call_ls1');
    expect(item.status).toBe('completed');
    // codex LocalShellAction は #[serde(tag="type")] で type:"exec" を必須とする
    const action = item.action as Record<string, unknown>;
    expect(action.type).toBe('exec');
    expect(action.command).toEqual(['ls', '-la']);
    expect(action.working_directory).toBe('/tmp');
    expect(action.timeout_ms).toBe(5000);
  });

  it('preserves existing exec type when upstream includes it', () => {
    const shellAction = { type: 'exec', command: ['echo hi'] };
    const response = buildResponse([
      {
        kind: 'tool_call',
        id: 'lsc_2',
        status: 'completed',
        toolCall: {
          id: 'fc_4',
          callId: 'call_ls2',
          type: 'builtin',
          name: 'local_shell',
          wireName: 'local_shell',
          builtinKind: 'local_shell',
          arguments: { action: shellAction },
          rawArguments: JSON.stringify({ action: shellAction }),
          originalType: 'function_call',
          status: 'completed',
          raw: {},
        },
      },
    ]);

    const result = toOpenAIResponse(baseRequest, response);
    const item = result.output[0] as Record<string, unknown>;

    const action = item.action as Record<string, unknown>;
    expect(action.type).toBe('exec');
    expect(action.command).toEqual(['echo hi']);
  });
});
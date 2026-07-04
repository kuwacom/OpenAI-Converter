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

  // 直前ターンの assistant 产出(message + custom_tool_call)を Codex が別々の input item として
  // 返送してくるケース。元実装では2つの連続した assistant メッセージに分解され、strict な上流 API が
  // 連続 assistant を拒否して 400 になる重大バグの回帰テスト
  it('merges consecutive assistant messages coming from split prior-turn outputs', () => {
    // 複数行パッチをソース中にリテラルで書くとエスケープ問題を起こすため join で組み立てる
    const patchBody = ['*** Begin Patch', '+hello world', '*** End Patch'].join(
      '\n',
    );
    const request = CreateResponseRequestSchema.parse({
      model: 'gpt-4o-mini',
      input: [
        { role: 'user', content: [{ type: 'input_text', text: 'fix it' }] },
        {
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'output_text', text: 'Patching now.' }],
        },
        {
          id: 'ctc_1',
          type: 'custom_tool_call',
          call_id: 'call_ap_1',
          name: 'apply_patch',
          input: patchBody,
          status: 'completed',
        },
        {
          type: 'custom_tool_call_output',
          call_id: 'call_ap_1',
          output: 'patch applied successfully',
        },
      ],
      tools: [{ type: 'custom', name: 'apply_patch' }],
    });

    const canonical = toCanonicalRequest(request);
    const mapped = mapToChatCompletions(canonical);
    const roles = mapped.request.messages.map((m) => m.role);

    // 統合前だと ['user','assistant','assistant','tool'] となる。
    // 上流 CC strict プロバイダは連続 assistant を拒否するため1つへ統合されなければならない
    expect(roles).toEqual(['user', 'assistant', 'tool']);

    const mergedAssistant = mapped.request.messages.find(
      (m) => m.role === 'assistant',
    )!;
    expect(mergedAssistant.content).toBe('Patching now.');
    expect(Array.isArray(mergedAssistant.tool_calls)).toBe(true);
    const call0 = mergedAssistant.tool_calls?.[0];
    expect(call0).toMatchObject({
      id: 'call_ap_1',
      type: 'function',
      function: { name: 'apply_patch' },
    });
    // 上流 wrapper 向けに {"input":"<patch text>"} 形式の JSON 文字列化されていること
    const fnArgs = (call0 as { function?: { arguments?: unknown } } | undefined)?.function?.arguments;
    expect(typeof fnArgs === 'string').toBe(true);
    if (typeof fnArgs === 'string') {
      const parsed = JSON.parse(fnArgs);
      expect(parsed).toEqual({ input: patchBody });
    }

    const toolMessage = mapped.request.messages.find((m) => m.role === 'tool')!;
    expect(toolMessage.tool_call_id).toBe('call_ap_1');
    expect(toolMessage.content).toBe('patch applied successfully');
  });
});
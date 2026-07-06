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
                description: 'Freeform text payload for this custom tool',
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

// 過去ターンの function_call.arguments が一度でも不正 JSON になると、Codex resume 再開時に
// 毎回上流へ再送され "function arguments must be valid JSON" 400 で永続的に停止する致命バグの回帰テスト。
// 既存履歴・responseStore 由来の壊れた引数も送信直前に安全化されなければならない
describe('malformed tool_call arguments hardening', () => {
  it('wraps malformed non-custom tool_call arguments into valid JSON for upstream', () => {
    // 上流モデルが壊れた引数を出力した想定。resume 再開時この生文字列が input items へ再送される
    const brokenArgs = '{not valid json';
    const request = CreateResponseRequestSchema.parse({
      model: 'gpt-5.4',
      input: [
        { role: 'user', content: [{ type: 'input_text', text: 'do something' }] },
        {
          type: 'function_call',
          call_id: 'call_broken_1',
          name: 'shell',
          arguments: brokenArgs,
        },
        {
          type: 'function_call_output',
          call_id: 'call_broken_1',
          output: '{"ok":true}',
        },
      ],
      tools: [
        {
          type: 'function',
          name: 'shell',
          parameters: { type: 'object', properties: {} },
        },
      ],
    });

    const mapped = mapToChatCompletions(toCanonicalRequest(request));
    const assistant = mapped.request.messages.find((m) => m.role === 'assistant')!;
    const call0 = assistant.tool_calls?.[0] as { function?: { arguments?: unknown } } | undefined;
    const fnArgs = call0?.function?.arguments;

    // 不正 JSON のままでは上流が拒否するため、valid JSON 文字列化されている必要がある
    expect(typeof fnArgs === 'string').toBe(true);
    if (typeof fnArgs === 'string') {
      // 上流が JSON parse 可能であることが保証されていなければならない
      const parsed = JSON.parse(fnArgs);
      // 内容を捨てず {_malformedArguments:"..."} 形式で保全されていること
      expect(parsed).toEqual({ _malformedArguments: brokenArgs });
    }
  });

  it('passes through already-valid tool_call arguments unchanged', () => {
    const validArgs = JSON.stringify({ command: ['ls', '-la'] });
    const request = CreateResponseRequestSchema.parse({
      model: 'gpt-5.4',
      input: [
        { role: 'user', content: [{ type: 'input_text', text: 'list files' }] },
        {
          type: 'function_call',
          call_id: 'call_ok_1',
          name: 'shell',
          arguments: validArgs,
        },
        {
          type: 'function_call_output',
          call_id: 'call_ok_1',
          output: 'done',
        },
      ],
      tools: [
        {
          type: 'function',
          name: 'shell',
          parameters: { type: 'object', properties: {} },
        },
      ],
    });

    const mapped = mapToChatCompletions(toCanonicalRequest(request));
    const assistant = mapped.request.messages.find((m) => m.role === 'assistant')!;
    const call0 = assistant.tool_calls?.[0] as { function?: { arguments?: unknown } } | undefined;
    const fnArgs = call0?.function?.arguments;

    // 有効な JSON 引数は多重エンコードされず構造保持で素通しされること
    expect(fnArgs).toBe(validArgs);
  });

  it('normalizes empty tool_call arguments into empty object string', () => {
    const request = CreateResponseRequestSchema.parse({
      model: 'gpt-5.4',
      input: [
        { role: 'user', content: [{ type: 'input_text', text: 'noop' }] },
        {
          type: 'function_call',
          call_id: 'call_empty_1',
          name: 'shell',
          arguments: '',
        },
        {
          type: 'function_call_output',
          call_id: 'call_empty_1',
          output: '{}',
        },
      ],
      tools: [
        {
          type: 'function',
          name: 'shell',
          parameters: { type: 'object', properties: {} },
        },
      ],
    });

    const mapped = mapToChatCompletions(toCanonicalRequest(request));
    const assistant = mapped.request.messages.find((m) => m.role === 'assistant')!;
    const call0 = assistant.tool_calls?.[0] as { function?: { arguments?: unknown } } | undefined;
    const fnArgs = call0?.function?.arguments;

    // 空文字列は strict 上流が空 arguments を拒否することがあるため "{}" へ正規化されること
    expect(fnArgs).toBe('{}');
  });
});

// Responses API の text.format(flat 形状)を Chat Completions の response_format(ネスト形状)へ
// 変換せずそのまま流すと、上流(litellm/NIM 等)が response_format.json_schema 必須フィールドデシリアライザで 400 を返す重大バグの回帰テスト。
describe('response_format conversion', () => {
  it('converts Responses flat json_schema format into ChatCompletions nested response_format', () => {
    const schema = {
      type: 'object',
      properties: { answer: { type: 'string' } },
      required: ['answer'],
    };
    const request = CreateResponseRequestSchema.parse({
      model: 'gpt-4o-mini',
      input: 'respond',
      text: {
        format: {
          type: 'json_schema',
          name: 'result',
          schema,
          strict: true,
        },
      },
    });

    const mapped = mapToChatCompletions(toCanonicalRequest(request));
    expect(mapped.request.response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'result', schema, strict: true },
    });
  });

  // json_schema 以外(json_object 等)は上流互換のためそのまま通す仕様の回帰テスト
  it('passes through non-json_schema text.format shapes unchanged as response_format', () => {
    const request = CreateResponseRequestSchema.parse({
      model: 'gpt-4o-mini',
      input: 'summarize',
      text: { format: { type: 'json_object' } },
    });

    const mapped = mapToChatCompletions(toCanonicalRequest(request));
    expect(mapped.request.response_format).toEqual({ type: 'json_object' });
  });

  // codex VSCode 拡張等は Responses API 経由で schema を JSON 文字列として送ってくる。
  // SGLang 等 strict 上流は response_format.json_schema.schema を辞書型必須とし文字列を拒否するため、
  // proxy 側で文字列→オブジェクトへ復元する必要がある
  it('parses stringified schema field into object for strict upstreams', () => {
    const schemaObj = { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'] };
    const request = CreateResponseRequestSchema.parse({
      model: 'gpt-4o-mini',
      input: 'respond',
      text: {
        format: {
          type: 'json_schema',
          name: 'result',
          schema: JSON.stringify(schemaObj),
          strict: true,
        },
      },
    });

    const mapped = mapToChatCompletions(toCanonicalRequest(request));
    expect(mapped.request.response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'result', schema: schemaObj, strict: true },
    });
  });
});

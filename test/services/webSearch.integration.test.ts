import { describe, expect, it } from 'vitest';
import { toCanonicalRequest } from '@/adapters/requestToCanonical';
import {
  hasWebSearchBuiltin,
  injectWebSearchContext,
  WEB_SEARCH_SYNTHETIC_WIRE_NAME,
} from '@/services/proxy/webSearchContext';
import { CreateResponseRequestSchema } from '@/schemas/responsesSchema';

describe('web_search builtin integration', () => {
  it('detects web_search declaration inside request.tools', () => {
    const canonical = toCanonicalRequest(
      CreateResponseRequestSchema.parse({
        model: 'test-model',
        input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
        tools: [
          { type: 'web_search', search_context_size: 'medium' },
          { type: 'function', name: 'f', parameters: {} },
        ],
      }),
    );

    expect(hasWebSearchBuiltin(canonical.tools)).toBe(true);
  });

  it('injects synthetic function tool and system instruction when web_search is declared', () => {
    const canonical = toCanonicalRequest(
      CreateResponseRequestSchema.parse({
        model: 'test-model',
        input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
        tools: [{ type: 'web_search_preview', external_web_access: true }],
        instructions: 'Be concise.',
      }),
    );

    const { request, rawToolsForExecute } = injectWebSearchContext(canonical);

    // 合成関数が tools 配列末尾へ追加される
    const synthetic = request.tools.find(
      (tool) => tool.wireName === WEB_SEARCH_SYNTHETIC_WIRE_NAME,
    );
    expect(synthetic).toBeDefined();
    expect(synthetic?.type).toBe('function');
    expect(rawToolsForExecute).toHaveLength(1);

    // 先頭システムメッセージへ指示注入(既存 instructions 含む)
    const systemMessage = request.messages[0];
    expect(systemMessage?.role).toBe('system');
    const injectedText = systemMessage?.content
      .map((part) => (part.type === 'text' ? part.text : ''))
      .join('\n');
    expect(injectedText).toContain('Be concise.');
    expect(injectedText).toContain(WEB_SEARCH_SYNTHETIC_WIRE_NAME);
  });

  it('does not inject when request lacks web_search builtin', () => {
    const canonical = toCanonicalRequest(
      CreateResponseRequestSchema.parse({
        model: 'm',
        input: 'hi',
        tools: [{ type: 'function', name: 'greet', parameters: {} }],
      }),
    );

    const { request, rawToolsForExecute } = injectWebSearchContext(canonical);
    expect(request.tools.find((t) => t.wireName === WEB_SEARCH_SYNTHETIC_WIRE_NAME)).toBeUndefined();
    expect(rawToolsForExecute).toEqual([]);
    // messages 構成も変更なし
    expect(request.messages.length).toBe(canonical.messages.length);
  });
});

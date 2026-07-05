import { describe, expect, it } from 'vitest';
import { buildWebSearchAwareFinalResponse } from '@/services/proxy/tooling';
import { CanonicalResponseSchema } from '@/schemas/responseSchema';
import type { CanonicalRequest, CanonicalResponse } from '@/models/canonical/response';
import { toCanonicalRequest } from '@/adapters/requestToCanonical';
import { CreateResponseRequestSchema } from '@/schemas/responsesSchema';

describe('web_search final response shape (OpenAI spec compliance)', () => {
  it('replaces synthetic function_call with web_search_call + url_citation annotations', () => {
    // source registry へ1件登録済の前提。最終回答本文に [S1] マーカーを含む
    const registry = new Map([
      ['S1', {
        id: 'S1',
        url: 'https://example.com/news',
        title: 'Example News',
        snippet: 'Breaking news.',
        excerpt: '',
        siteName: null,
      }],
    ]);

    const request: CanonicalRequest = toCanonicalRequest(
      CreateResponseRequestSchema.parse({
        model: 'test-model',
        input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
        tools: [{ type: 'web_search' }],
      }),
    );

    // 最終回答に合成関数 builtin_web_search の function_call + 通常 message 双方を含む模擬レスポンス
    const responseInput = {
      id: request.id,
      object: 'response' as const,
      createdAt: Math.floor(Date.now() / 1000),
      status: 'completed',
      model: request.model,
      output: [
        {
          kind: 'tool_call' as const,
          id: 'fc_builtin_001',
          status: 'completed',
          toolCall: {
            id: 'fc_builtin_001',
            callId: 'call_001',
            type: 'function' as const,
            name: 'builtin_web_search',
            wireName: 'builtin_web_search',
            arguments: { action: 'search', query: 'latest news' },
            rawArguments: '{}',
            originalType: 'web_search_call',
            status: 'completed',
          },
        },
        {
          kind: 'message' as const,
          id: 'msg_final',
          status: 'completed',
          role: 'assistant',
          content: [
            { type: 'text', text: 'Based on [S1], the answer is here.' },
          ],
        },
      ],
    };
    const response: CanonicalResponse =
      CanonicalResponseSchema.parse(responseInput);

    const result = buildWebSearchAwareFinalResponse({
      response,
      executedCalls: [
        {
          id: 'call_001',
          payload: { action: 'search' as const, query: 'latest news', queries: null, url: null },
        },
      ],
      registry,
    });

    // 合成 builtin_web_search function_call は除去される
    const remainingFunctionCalls = result.output.filter(
      (item) =>
        item.kind === 'tool_call' &&
        (item.toolCall.wireName === 'builtin_web_search' ||
          item.toolCall.name === 'builtin_web_search'),
    );
    expect(remainingFunctionCalls).toHaveLength(0);

    // 代わりに web_search_call アイテム(completed, action search 含む)が生成
    const wsCallItem = result.output.find((item) => item.kind === 'web_search_call');
    expect(wsCallItem).toBeDefined();
   if (wsCallItem && wsCallItem.kind === 'web_search_call') {
     expect(wsCallItem.status).toBe('completed');
      // action union 型ナローイングのため type で絞り込んでから query 参照する
      const action = wsCallItem.action;
      if (action && action.type === 'search') {
        expect(action.query).toBe('latest news');
      } else {
        throw new Error('expected search action');
      }
   }

   // assistant message content へ url_citation annotations が付与
   const msgItem = result.output.find((item) => item.kind === 'message');
   expect(msgItem).toBeDefined();
   if (msgItem && msgItem.kind === 'message') {
     const textPart = msgItem.content.find((p) => p.type === 'text');
     if (textPart && textPart.type === 'text') {
       const anns = textPart.annotations ?? [];
       expect(anns).toHaveLength(1);
      expect(anns[0]?.type).toBe('url_citation');
      expect(anns[0]?.url).toBe('https://example.com/news');
    }
  }
});
});

import { describe, expect, it } from 'vitest';
import { toCanonicalRequest } from '@/adapters/requestToCanonical';
import { CreateResponseRequestSchema } from '@/schemas/responsesSchema';

// McpToolCallOutput / 構造型 function_call_output(content_items 配列)の
// 正規化ロジックを検証する。codex は MCP ツール結果として CallToolResult や
// input_text/input_image を含む content_items 配列を送信する
describe('structured function_call_output normalization', () => {
  it('normalizes mcp_tool_call_output with object output', () => {
    const request = CreateResponseRequestSchema.parse({
      model: 'gpt-5.4',
      input: [
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'search files' }],
        },
        {
          id: 'fc_1',
          type: 'function_call',
          call_id: 'call_mcp_1',
          name: 'search',
          namespace: 'mcp__filesystem__',
          arguments: '{"query":"report"}',
          status: 'completed',
        },
        {
          type: 'mcp_tool_call_output',
          call_id: 'call_mcp_1',
          output: {
            content: [{ type: 'text', text: 'found 3 files' }],
            is_error: false,
          },
        },
      ],
      tools: [],
    });

    const canonical = toCanonicalRequest(request);
    const toolMessages = canonical.messages.filter(
      (m) => m.role === 'tool' && m.toolCallId === 'call_mcp_1',
    );
    expect(toolMessages.length).toBe(1);
    // オブジェクト形式 output は raw part へ保持される
    expect(toolMessages[0]!.content[0]!.type).toBe('raw');
  });

  it('normalizes function_call_output with content_items array (text + image)', () => {
    const request = CreateResponseRequestSchema.parse({
      model: 'gpt-5.4',
      input: [
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'capture screen' }],
        },
        {
          type: 'function_call_output',
          call_id: 'call_img_1',
          output: [
            { type: 'input_text', text: 'Screenshot captured' },
            { type: 'input_image', image_url: 'data:image/png;base64,abc' },
          ],
        },
      ],
      tools: [],
    });

    const canonical = toCanonicalRequest(request);
    const toolMessages = canonical.messages.filter(
      (m) => m.role === 'tool' && m.toolCallId === 'call_img_1',
    );
    expect(toolMessages.length).toBe(1);
    const content = toolMessages[0]!.content;
    // テキスト + 画像の2パートへ復元される
    expect(content.length).toBe(2);
    expect(content[0]!.type).toBe('text');
    expect(content[1]!.type).toBe('image');
    if (content[1]!.type === 'image') {
      expect(content[1]!.imageUrl).toBe('data:image/png;base64,abc');
    }
  });

  it('preserves plain string output backward compatibility', () => {
    const request = CreateResponseRequestSchema.parse({
      model: 'gpt-5.4',
      input: [
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'run command' }],
        },
        {
          type: 'function_call_output',
          call_id: 'call_str_1',
          output: 'command succeeded',
        },
      ],
      tools: [],
    });

    const canonical = toCanonicalRequest(request);
    const toolMessages = canonical.messages.filter(
      (m) => m.role === 'tool' && m.toolCallId === 'call_str_1',
    );
    expect(toolMessages.length).toBe(1);
    expect(toolMessages[0]!.content[0]!.type).toBe('text');
  });

  it('handles custom_tool_call_output with structured output', () => {
    const request = CreateResponseRequestSchema.parse({
      model: 'gpt-5.4',
      input: [
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'apply patch' }],
        },
        {
          type: 'custom_tool_call_output',
          call_id: 'call_ap_1',
          name: 'apply_patch',
          output: [{ type: 'input_text', text: 'patch applied successfully' }],
        },
      ],
      tools: [],
    });

    const canonical = toCanonicalRequest(request);
    const toolMessages = canonical.messages.filter(
      (m) => m.role === 'tool' && m.toolCallId === 'call_ap_1',
    );
    expect(toolMessages.length).toBe(1);
    expect(toolMessages[0]!.content[0]!.type).toBe('text');
  });
});
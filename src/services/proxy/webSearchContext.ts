import { isWebSearchToolType } from '@/lib/webSearch/core';
import type { CanonicalRequest } from '@/models/canonical/response';
import type { CanonicalMessage } from '@/models/canonical/message';
import type { CanonicalTool } from '@/models/canonical/tool';
import type { CanonicalToolCall } from '@/models/canonical/message';

// upstream Chat Completions には web_search builtin 概念がないため、
// proxy が合成 function として提示し model に呼ばせる誘導橋渡しを行う(方針B)
export const WEB_SEARCH_SYNTHETIC_TOOL_NAME = 'builtin_web_search';
export const WEB_SEARCH_SYNTHETIC_WIRE_NAME = 'builtin_web_search';

// model へ「この関数で検索せよ」と促す指示文。actions=search/open_page/find_in_page を網羅する
const WEB_SEARCH_INSTRUCTION = [
  'A web_search built-in tool is available via the proxy. When you need fresh or external information, call the function "' +
    WEB_SEARCH_SYNTHETIC_WIRE_NAME +
    '" instead of relying on internal knowledge.',
  'Supported actions (pass as JSON arguments):',
  '- {"action":"search","query":"<text>"} : run a web search and return top sources with excerpts.',
  '- {"action":"open_page","url":"<url>"} : fetch a single page content.',
  '- {"action":"find_in_page","url":"<url>","query":"<text>"} : fetch a page and extract matching excerpts.',
  'After the call returns, cite sources inline using markers like [S1]. Do not fabricate URLs.',
].join('\n');

/**
 * ### hasWebSearchBuiltin
 * request.tools 内に web_search 系譜宣言が含まれるか判定
 */
export const hasWebSearchBuiltin = (
  tools: readonly CanonicalTool[],
): boolean =>
  tools.some(
    (tool) => tool.type === 'builtin' && isWebSearchToolType(tool.originalType),
  );

/**
 * ### buildWebSearchSyntheticTool
 * upstream へ提示する合成関数ツール定義(JSON Schema)を生成する。
 *
 * 引数形状は execute 側(executeWebSearch)が normalize できるよう action/query/url を緩く受け付ける
 */
export const buildWebSearchSyntheticTool = (): Record<string, unknown> => ({
  type: 'function',
  function: {
    name: WEB_SEARCH_SYNTHETIC_WIRE_NAME,
    description:
      'Proxy-managed web search built-in. Invoke when web grounding is required.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['search', 'open_page', 'find_in_page'],
          description: 'Search action to perform. Defaults to "search".',
        },
        query: {
          type: 'string',
          description:
            'Search query text (search/find_in_page) or excerpt needle.',
        },
        url: {
          type: 'string',
          description: 'Target URL for open_page/find_in_page actions.',
        },
      },
      additionalProperties: false,
    },
  },
});


/**
 * ### injectWebSearchContext
 * canonical request へ web_search 合成関数定義追加と system 指示注入を行い新 request を返す。
 *
 * 既存 messages/instructions を破壊しないよう immutable コピーで構築する
 */
export const injectWebSearchContext = (
  request: CanonicalRequest,
): {
  request: CanonicalRequest;
  /** リクエスト元 tools 配列(raw 形状)。execute 時の config 抽出へ渡す */
  rawToolsForExecute: unknown[];
} => {
  if (!hasWebSearchBuiltin(request.tools)) {
    return { request, rawToolsForExecute: [] };
  }

  // 合成 tool 定義を canonical tools 配列末尾へ追加。wireName 衝突回避済みのためそのまま append する
  const syntheticTool: CanonicalTool = {
    id: 'tool_web_search_builtin',
    type: 'function',
    name: WEB_SEARCH_SYNTHETIC_TOOL_NAME,
    wireName: WEB_SEARCH_SYNTHETIC_WIRE_NAME,
    description:
      'Proxy-managed web search built-in. Invoke when web grounding is required.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['search', 'open_page', 'find_in_page'] },
        query: { type: 'string' },
        url: { type: 'string' },
      },
      additionalProperties: false,
    },
    originalType: 'web_search',
    raw: buildWebSearchSyntheticTool(),
  };

  const existingInstructionText =
    typeof request.instructions === 'string' ? request.instructions : '';

  // 先頭システムメッセージへ指示注入。既存 instructions と併存させる
  const injectedSystemMessage: CanonicalMessage = {
    id: 'msg_system_websearch',
    role: 'system',
    content: [
      ...(existingInstructionText
        ? [{ type: 'text' as const, text: existingInstructionText }]
        : []),
      { type: 'text' as const, text: WEB_SEARCH_INSTRUCTION },
    ],
  };

  return {
    request: {
      ...request,
      instructions: undefined,
      tools: [...request.tools, syntheticTool],
      messages: [injectedSystemMessage, ...request.messages],
    },
    rawToolsForExecute: request.tools.map((tool) => tool.raw),
  };
};

/**
 * ### extractWebSearchToolCallIdsFromResponse
 * 応答 output 中の web_search 合成関数呼出 ID 一覧を返す。
 * proxy 完結型サブループで「再ターン要否」判定用に使用する
 */
export const extractWebSearchToolCallsFromResponse = (
  responseOutput: readonly {
    kind: string;
    toolCall?: Partial<CanonicalToolCall>;
  }[],
): string[] =>
  responseOutput
    .filter((item) => item.kind === 'tool_call' && item.toolCall)
    .map((item) => item.toolCall?.wireName ?? item.toolCall?.name ?? '')
    .filter(
      (name): name is string =>
        typeof name === 'string' &&
        name === WEB_SEARCH_SYNTHETIC_WIRE_NAME,
    );

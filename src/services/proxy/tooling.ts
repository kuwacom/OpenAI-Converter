import type {
  CanonicalRequest,
  CanonicalResponse,
  CanonicalResponseOutput,
  CanonicalTool,
} from '@/models/canonical/response';
import type {
  CanonicalMessage,
  CanonicalToolCall,
} from '@/models/canonical/message';
import {
  createCallId,
  createFunctionCallId,
  createMessageId,
  createReasoningId,
} from '@/lib/ids';
import { safeJsonParse, toJsonString } from '@/lib/jsonUtils';
import { asObject } from '@/lib/object';
import { extractCustomToolInput } from '@/lib/customToolInput';
import { extractTagContents, stripTags } from '@/lib/text';
import { DEFAULT_MAX_TOOL_CALLS } from '@/configs/constants';

const TOOL_TAG_PATTERN = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi;
const THINK_TAG_PATTERN =
  /<(?:think|reasoning)>\s*([\s\S]*?)\s*<\/(?:think|reasoning)>/gi;

type ParsedToolCall = {
  name: string;
  arguments: unknown;
  rawArguments: string;
};


const findToolByName = (tools: CanonicalTool[], name: string) => {
  const normalized = name.trim();

  return tools.find((tool) =>
    [tool.name, tool.wireName, tool.originalType].some(
      (candidate) => typeof candidate === 'string' && candidate === normalized,
    ),
  );
};

const parseTaggedToolCalls = (
  content: string,
  tools: CanonicalTool[],
): ParsedToolCall[] =>
  extractTagContents(content, TOOL_TAG_PATTERN).map((chunk) => {
    const rawArguments = chunk.trim();
    const parsed = safeJsonParse<Record<string, unknown>>(rawArguments) ?? {};
    const name = typeof parsed.name === 'string' ? parsed.name : 'unknown_tool';

    // Custom(Freeform)ツール(apply_patch 等)は {"input":"<raw text>"} 形式で来る。
    // arguments/rawArguments 双方へ素テキスト(input 値)を格納しないと
    // downstream の Codex apply_patch 検証が "*** Begin Patch" を先頭認識できず失敗する
    const tool = findToolByName(tools, name);
    if (tool?.type === 'custom') {
      const extracted = extractCustomToolInput(rawArguments);
      return {
        name,
        arguments: extracted,
        rawArguments: extracted,
      };
    }

    return {
      name,
      arguments:
        parsed && typeof parsed === 'object' && 'arguments' in parsed
          ? (parsed as { arguments: unknown }).arguments
          : {},
      rawArguments,
    };
  });

const parseAssistantPayload = (content: string, tools: CanonicalTool[]) => {
  const parsedToolCalls = parseTaggedToolCalls(content, tools);
  const reasoningText = extractTagContents(content, THINK_TAG_PATTERN)
    .join('\n\n')
    .trim();
  const visibleText = stripTags(
    stripTags(content, THINK_TAG_PATTERN),
    TOOL_TAG_PATTERN,
  );

  const toolCalls: CanonicalToolCall[] = parsedToolCalls.map((toolCall) => {
    const tool = findToolByName(tools, toolCall.name);

    return {
      id: createFunctionCallId(),
      callId: createCallId(),
      type: tool?.type ?? 'function',
      name: tool?.name ?? toolCall.name,
      wireName: tool?.wireName ?? toolCall.name,
      arguments: toolCall.arguments,
      rawArguments: toolCall.rawArguments,
      originalType: tool?.originalType ?? 'function',
      status: 'completed',
      raw: toolCall,
    };
  });

  return {
    visibleText,
    reasoningText,
    toolCalls,
  };
};

const buildOutputs = (
  content: string,
  tools: CanonicalTool[],
): CanonicalResponseOutput[] => {
  const parsed = parseAssistantPayload(content, tools);
  const output: CanonicalResponseOutput[] = [];

  if (parsed.reasoningText) {
    output.push({
      kind: 'reasoning',
      id: createReasoningId(),
      status: 'completed',
      text: parsed.reasoningText,
    });
  }

  output.push(
    ...parsed.toolCalls.map((toolCall) => ({
      kind: 'tool_call' as const,
      id: createFunctionCallId(),
      status: 'completed',
      toolCall,
    })),
  );

  if (parsed.visibleText) {
    output.push({
      kind: 'message',
      id: createMessageId(),
      status: 'completed',
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: parsed.visibleText,
        },
      ],
    });
  }

  return output;
};

const extractResponseText = (response: CanonicalResponse) => {
  if (typeof response.text === 'string' && response.text.length > 0) {
    return response.text;
  }

  const textFromOutput = response.output
    .filter(
      (item): item is Extract<CanonicalResponseOutput, { kind: 'message' }> =>
        item.kind === 'message',
    )
    .flatMap((item) => item.content)
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n');

  if (textFromOutput) {
    return textFromOutput;
  }

  const raw = asObject(response.raw);
  return typeof raw?.text === 'string' ? raw.text : '';
};

const toAssistantToolCallMessage = (
  toolCalls: CanonicalToolCall[],
): CanonicalMessage => ({
  id: createMessageId(),
  role: 'assistant',
  content: [],
  toolCalls,
});

const toToolResultMessage = (
  toolCall: CanonicalToolCall,
): CanonicalMessage => ({
  id: createMessageId(),
  role: 'tool',
  toolCallId: toolCall.callId,
  content: [
    {
      type: 'text',
      text:
        typeof toolCall.rawArguments === 'string'
          ? toolCall.rawArguments
          : typeof toolCall.arguments === 'string'
            ? toolCall.arguments
            : toJsonString(toolCall.arguments, '{}'),
    },
  ],
});

export const synthesizeCanonicalResponseOutputs = (
  response: CanonicalResponse,
  tools: CanonicalTool[],
): CanonicalResponse => {
  if (response.output.length > 0) {
    return response;
  }

  const text = extractResponseText(response);
  if (!text) {
    return response;
  }

  const parsed = parseAssistantPayload(text, tools);

  return {
    ...response,
    text: parsed.visibleText,
    output: buildOutputs(text, tools),
    reasoning:
      parsed.reasoningText || response.reasoning
        ? {
            ...response.reasoning,
            summary:
              parsed.reasoningText || response.reasoning?.summary || null,
          }
        : response.reasoning,
  };
};

export const executeToolLoop = async ({
  request,
  initialResponse,
  executeTurn,
}: {
  request: CanonicalRequest;
  initialResponse: CanonicalResponse;
  executeTurn: (request: CanonicalRequest) => Promise<CanonicalResponse>;
}): Promise<CanonicalResponse> => {
  let response = synthesizeCanonicalResponseOutputs(
    initialResponse,
    request.tools,
  );
  let messages = [...request.messages];
  let totalToolCalls = 0;
  const maxToolCalls = request.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS;

  while (true) {
    const toolCalls = response.output
      .filter(
        (
          item,
        ): item is Extract<CanonicalResponseOutput, { kind: 'tool_call' }> =>
          item.kind === 'tool_call',
      )
      .map((item) => item.toolCall);

    if (toolCalls.length === 0) {
      return response;
    }

    totalToolCalls += toolCalls.length;
    if (totalToolCalls > maxToolCalls) {
      return {
        ...response,
        incompleteDetails: {
          reason: 'max_tool_calls_exceeded',
        },
      };
    }

    messages = [
      ...messages,
      toAssistantToolCallMessage(toolCalls),
      ...toolCalls.map((toolCall) => toToolResultMessage(toolCall)),
    ];

    response = synthesizeCanonicalResponseOutputs(
      await executeTurn({
        ...request,
        messages,
        stream: false,
      }),
      request.tools,
    );
  }
};



import { executeWebSearch } from '@/lib/webSearch/execution';
import {
  createWebSearchSourceRegistry,
} from '@/lib/webSearch/sources';
import {
  extractWebSearchToolCallsFromResponse,
  WEB_SEARCH_SYNTHETIC_WIRE_NAME,
  hasWebSearchBuiltin,
} from '@/services/proxy/webSearchContext';
import type { WebSearchConfig } from '@/types/env';

/**
 * ### executeWebSearchSubLoop
 * web_search builtin 専用の proxy 完結型サブループ。
 *
 * upstream 応答に合成関数(builtin_web_search)呼出が含まれる限り:
 *   1. ツールコール引数を SearXNG 経由で実行
 *   2. assistant tool_call + tool result メッセージを messages へ追加
 *   3. 再ターンして最終回答を得る
 *
 * ユーザ宣言 custom/function ツールは Codex クライアント側ループで処理されるため対象外。
 * maxToolCalls 上限到達時は incompleteDetails.reason="max_tool_calls_exceeded" を付与する
 */
export const executeWebSearchSubLoop = async ({
  request,
  initialResponse,
  executeTurn,
  rawToolsForExecute,
  webSearchConfig,
  signal,
}: {
  request: CanonicalRequest;
  initialResponse: CanonicalResponse;
  executeTurn: (nextRequest: CanonicalRequest) => Promise<CanonicalResponse>;
  rawToolsForExecute: readonly unknown[];
  webSearchConfig: WebSearchConfig;
  signal?: AbortSignal;
}): Promise<CanonicalResponse> => {
  // リクエストが web_search builtin を含まない場合はそのまま返す(早期 exit)
  if (!hasWebSearchBuiltin(request.tools)) {
    return initialResponse;
  }

  const registry = createWebSearchSourceRegistry();
  let response = synthesizeCanonicalResponseOutputs(initialResponse, request.tools);
  let messages = [...request.messages];
  let totalToolCalls = 0;
  const maxToolCalls = request.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS;

  while (true) {
    const toolCallItems = response.output.filter(
      (
        item,
      ): item is Extract<CanonicalResponseOutput, { kind: 'tool_call' }> =>
        item.kind === 'tool_call',
    );
    const wsCallIds = new Set(
      extractWebSearchToolCallsFromResponse(toolCallItems),
    );

    if (wsCallIds.size === 0) {
      return response;
    }

    totalToolCalls += wsCallIds.size;
    if (totalToolCalls > maxToolCalls) {
      return {
        ...response,
        incompleteDetails: { reason: 'max_tool_calls_exceeded' },
      };
    }

    const wsToolCalls = toolCallItems.filter((item) =>
      item.toolCall.wireName === WEB_SEARCH_SYNTHETIC_WIRE_NAME ||
      item.toolCall.name === WEB_SEARCH_SYNTHETIC_WIRE_NAME
    );
    messages = [
      ...messages,
      toAssistantToolCallMessage(wsToolCalls.map((item) => item.toolCall)),
      ...(await Promise.all(
        wsToolCalls.map(async (item) => {
          const tc = item.toolCall;
          const result = await executeWebSearch({
            callArguments: tc.arguments,
            toolsConfigRaw: rawToolsForExecute,
            registry,
            params: { config: webSearchConfig },
            signal,
          });
          return toTextToolResultMessage(tc.callId, result.modelInputText);
        }),
      )),
    ];

    response = synthesizeCanonicalResponseOutputs(
      await executeTurn({ ...request, messages, stream: false }),
      request.tools,
    );
  }
};

/**
 * ### toTextToolResultMessage
 * 単純な文字列 content の tool result メッセージ生成ヘルパ(executeWebSearchSubLoop 用)
 */
const toTextToolResultMessage = (
  callId: string,
  text: string,
): CanonicalMessage => ({
  id: createMessageId(),
  role: 'tool',
  toolCallId: callId,
  content: [{ type: 'text', text }],
});

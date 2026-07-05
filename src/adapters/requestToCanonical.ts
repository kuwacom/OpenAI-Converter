import { type CanonicalRequest } from '@/models/canonical/response';
import type { CanonicalContentPart } from '@/models/canonical/content';
import type {
  CanonicalMessage,
  CanonicalToolCall,
} from '@/models/canonical/message';
import type { CanonicalTool } from '@/models/canonical/tool';
import type { CreateResponseRequest } from '@/models/responsesModel';
import { CanonicalRequestSchema } from '@/schemas/requestSchema';
import {
  createCallId,
  createFunctionCallId,
  createId,
  createMessageId,
  createResponseId,
} from '@/lib/ids';
import { safeJsonParse, toJsonString } from '@/lib/jsonUtils';
import { asObject } from '@/lib/object';

type PreviousConversationContext = {
  previousInputItems?: unknown[];
  previousOutputItems?: unknown[];
};

const createTextPart = (text: string): CanonicalContentPart => ({
  type: 'text',
  text,
});

const createRawPart = (raw: unknown): CanonicalContentPart => ({
  type: 'raw',
  raw,
});

const createReasoningPart = (text: string): CanonicalContentPart => ({
  type: 'reasoning',
  text,
});

const toStringArray = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];

const normalizeTool = (
  tool: Record<string, unknown>,
  index: number,
): CanonicalTool => {
  const rawType = typeof tool.type === 'string' ? tool.type : 'unknown';
  const rawName = typeof tool.name === 'string' ? tool.name : undefined;

  if (rawType === 'function') {
    const name = rawName ?? `function_${index}`;

    return {
      id: createId('tool'),
      type: 'function',
      name,
      wireName: name,
      description:
        typeof tool.description === 'string' ? tool.description : undefined,
      parameters: asObject(tool.parameters),
      strict: typeof tool.strict === 'boolean' ? tool.strict : undefined,
      originalType: rawType,
      raw: tool,
    };
  }

  if (rawType === 'custom') {
    const name = rawName ?? `custom_${index}`;

    return {
      id: createId('tool'),
      type: 'custom',
      name,
      wireName: name,
      description:
        typeof tool.description === 'string' ? tool.description : undefined,
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
      originalType: rawType,
      raw: tool,
    };
  }

  if (rawType === 'mcp') {
    const name =
      rawName ??
      (typeof tool.connector_id === 'string' ? tool.connector_id : undefined) ??
      `mcp_${index}`;

    return {
      id: createId('tool'),
      type: 'mcp',
      name,
      wireName: `mcp_${index}`,
      description: `Placeholder MCP bridge for ${name}`,
      parameters: {
        type: 'object',
        properties: {
          tool_name: { type: 'string' },
          input: { type: 'object' },
        },
        required: ['tool_name'],
      },
      originalType: rawType,
      raw: tool,
    };
  }

  const name = rawName ?? rawType ?? `tool_${index}`;

  return {
    id: createId('tool'),
    type: rawType === 'unknown' ? 'unknown' : 'builtin',
    name,
    wireName: name,
    description:
      typeof tool.description === 'string'
        ? tool.description
        : `Built-in or provider tool: ${name}`,
    originalType: rawType,
    raw: tool,
  };
};

const normalizeContentPart = (part: unknown): CanonicalContentPart[] => {
  if (typeof part === 'string') {
    return [createTextPart(part)];
  }

  const objectPart = asObject(part);

  if (!objectPart) {
    return [createRawPart(part)];
  }

  const rawType = typeof objectPart.type === 'string' ? objectPart.type : 'raw';

  if (
    rawType === 'input_text' ||
    rawType === 'output_text' ||
    rawType === 'text'
  ) {
    return [
      createTextPart(
        typeof objectPart.text === 'string'
          ? objectPart.text
          : toJsonString(objectPart, ''),
      ),
    ];
  }

  if (rawType === 'input_image') {
    return [
      {
        type: 'image',
        imageUrl:
          typeof objectPart.image_url === 'string'
            ? objectPart.image_url
            : undefined,
        detail:
          typeof objectPart.detail === 'string' ? objectPart.detail : undefined,
        raw: objectPart,
      },
    ];
  }

  if (rawType === 'input_file') {
    return [
      {
        type: 'file',
        fileId:
          typeof objectPart.file_id === 'string'
            ? objectPart.file_id
            : undefined,
        fileUrl:
          typeof objectPart.file_url === 'string'
            ? objectPart.file_url
            : undefined,
        raw: objectPart,
      },
    ];
  }

  if (rawType === 'reasoning') {
    return [
      createReasoningPart(
        typeof objectPart.text === 'string'
          ? objectPart.text
          : toJsonString(objectPart, ''),
      ),
    ];
  }

  return [createRawPart(objectPart)];
};

const normalizeContent = (content: unknown): CanonicalContentPart[] => {
  if (Array.isArray(content)) {
    return content.flatMap((part) => normalizeContentPart(part));
  }

  return normalizeContentPart(content);
};

const isResponseMessage = (item: Record<string, unknown>) =>
  item.type === 'message' && typeof item.role === 'string';

const createToolCallFromItem = (
  item: Record<string, unknown>,
  tools: CanonicalTool[],
): CanonicalToolCall | undefined => {
  const itemType = typeof item.type === 'string' ? item.type : undefined;

  if (!itemType) {
    return undefined;
  }

  if (itemType === 'function_call') {
    const name = typeof item.name === 'string' ? item.name : 'unknown_function';
    const tool = tools.find(
      (entry) => entry.wireName === name || entry.name === name,
    );

    return {
      id: typeof item.id === 'string' ? item.id : createFunctionCallId(),
      callId: typeof item.call_id === 'string' ? item.call_id : createCallId(),
      type: tool?.type ?? 'function',
      name,
      wireName: tool?.wireName ?? name,
    parentNamespace: (typeof item.namespace === 'string' ? item.namespace : undefined) ?? tool?.parentNamespace,
      arguments:
        typeof item.arguments === 'string'
          ? (safeJsonParse(item.arguments) ?? item.arguments)
          : item.arguments,
      rawArguments:
        typeof item.arguments === 'string' ? item.arguments : undefined,
      originalType: itemType,
      status: typeof item.status === 'string' ? item.status : 'completed',
      raw: item,
    };
  }

  const itemTypeLooksLikeCall =
    itemType.endsWith('_call') ||
    itemType === 'custom_tool_call' ||
    itemType === 'mcp_call';

  if (!itemTypeLooksLikeCall) {
    return undefined;
  }

  const name =
    typeof item.name === 'string' ? item.name : itemType.replace(/_call$/, '');

  const tool = tools.find(
    (entry) => entry.wireName === name || entry.name === name,
  );

  return {
    id: typeof item.id === 'string' ? item.id : createFunctionCallId(),
    callId: typeof item.call_id === 'string' ? item.call_id : createCallId(),
    type:
      tool?.type ??
      (itemType === 'mcp_call'
        ? 'mcp'
        : itemType === 'custom_tool_call'
          ? 'custom'
          : 'builtin'),
    name,
    wireName: tool?.wireName ?? name,
    parentNamespace: (typeof item.namespace === 'string' ? item.namespace : undefined) ?? tool?.parentNamespace,
    arguments: item.arguments ?? item.input ?? item.payload,
    rawArguments:
      typeof item.arguments === 'string'
        ? item.arguments
        : typeof item.input === 'string'
          ? item.input
          : undefined,
    originalType: itemType,
    status: typeof item.status === 'string' ? item.status : 'completed',
    raw: item,
  };
};


/**
 * ### expandRequestTools
 * request.tools の各エントリを正規化する。namespace 型のツール群は子関数へフラット化する。
 *
 * Codex 由来の {type:"namespace", name:"mcp__...", tools:[{type:"function", ...}, ...]} 形式を想定。
 * 上流 Chat Completions には namespace 概念がないため、各子を wireName=`${nsName}-${childName}` の独立関数として提示する(codex-relay 実測慣習に準拠)。
 * 親元 namespace 名は parentNamespace フィールドへ保持し canonicalToResponse 出力時の namespace 復元で参照する。
 */
const expandRequestTools = (
  rawTools: readonly unknown[],
): CanonicalTool[] =>
  rawTools.flatMap((entry): CanonicalTool[] => {
    const tool = asObject(entry);
    if (!tool) return [];

    if (typeof tool.type === 'string' && tool.type === 'namespace') {
      // 親名前空間名。欠前空間名。欠損時は衝突回避のため固定文字列へ退化する(呼出し側での復号整合は保証しない)
      const nsName =
        typeof tool.name === 'string'
          ? tool.name
          : 'namespace';
      const children = Array.isArray(tool.tools) ? tool.tools : [];
      return children.map((childEntry): CanonicalTool => {
        const childObject = asObject(childEntry);
        // 子が object 形状でなければ内容落ちを防ぐため unknown 型 placeholder へ寄せる
        if (!childObject) {
          return {
            id: createId('tool'),
            type: 'unknown',
            name: `${nsName}-unknown`,
            wireName: `${nsName}-unknown`,
            parentNamespace: nsName,
            description: 'Unrecognized nested tool entry',
            originalType: 'namespace',
            raw: { parent: tool, child: childEntry },
          };
        }
        // 子自体も既定の tool 形式とみなし normalizeTool 経由で一次正規化する。
        // 子種別(function/custom/builtin 等)ごとの schema/strict/parameters 保持は子自身の型宣言優先
        const base = normalizeTool(childObject, 0);
        return {
          ...base,
          // 上流へ提示する一意な関数名。親名前空間接頭辞付与で同名子関数の衝突を防ぐ
          wireName: `${nsName}-${base.wireName}`,
          parentNamespace: nsName,
          raw: { parent: tool, child: childObject },
        };
      });
    }

    return [normalizeTool(tool, 0)];
  });
const normalizeMessageLikeItem = (
  item: Record<string, unknown>,
  tools: CanonicalTool[],
): CanonicalMessage => {
  const content: CanonicalContentPart[] =
    'content' in item
      ? normalizeContent(item.content)
      : typeof item.text === 'string'
        ? [createTextPart(item.text)]
        : [createRawPart(item)];

  const toolCalls = Array.isArray(item.tool_calls)
    ? item.tool_calls
        .map((entry) => asObject(entry))
        .filter((entry): entry is Record<string, unknown> => Boolean(entry))
        .map((entry) => createToolCallFromItem(entry, tools))
        .filter((entry): entry is CanonicalToolCall => Boolean(entry))
    : undefined;

  return {
    id: typeof item.id === 'string' ? item.id : createMessageId(),
    role:
      item.role === 'system' ||
      item.role === 'developer' ||
      item.role === 'user' ||
      item.role === 'assistant' ||
      item.role === 'tool'
        ? item.role
        : 'user',
    content,
    toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
    toolCallId:
      typeof item.tool_call_id === 'string' ? item.tool_call_id : undefined,
    name: typeof item.name === 'string' ? item.name : undefined,
    raw: item,
  };
};

const normalizeToolOutputItem = (
  item: Record<string, unknown>,
): CanonicalMessage => ({
  id: typeof item.id === 'string' ? item.id : createMessageId(),
  role: 'tool',
  toolCallId:
    typeof item.call_id === 'string'
      ? item.call_id
      : typeof item.tool_call_id === 'string'
        ? item.tool_call_id
        : createCallId(),
  content:
    typeof item.output === 'string'
      ? [createTextPart(item.output)]
      : item.output
        ? [createRawPart(item.output)]
        : typeof item.content === 'string'
          ? [createTextPart(item.content)]
          : [createRawPart(item)],
  raw: item,
});

const toCanonicalMessage = (
  item: unknown,
  tools: CanonicalTool[],
): CanonicalMessage[] => {
  if (typeof item === 'string') {
    return [
      {
        id: createMessageId(),
        role: 'user',
        content: [createTextPart(item)],
      },
    ];
  }

  const objectItem = asObject(item);

  if (!objectItem) {
    return [
      {
        id: createMessageId(),
        role: 'user',
        content: [createRawPart(item)],
      },
    ];
  }

  if (isResponseMessage(objectItem) || typeof objectItem.role === 'string') {
    return [normalizeMessageLikeItem(objectItem, tools)];
  }

  if (
    objectItem.type === 'function_call_output' ||
    objectItem.type === 'custom_tool_call_output' ||
    objectItem.type === 'mcp_approval_response'
  ) {
    return [normalizeToolOutputItem(objectItem)];
  }

  if (objectItem.type === 'reasoning') {
    return [
      {
        id:
          typeof objectItem.id === 'string' ? objectItem.id : createMessageId(),
        role: 'assistant',
        content: [
          createReasoningPart(
            typeof objectItem.text === 'string'
              ? objectItem.text
              : toJsonString(objectItem.summary ?? objectItem, ''),
          ),
        ],
        raw: objectItem,
      },
    ];
  }

  const toolCall = createToolCallFromItem(objectItem, tools);

  if (toolCall) {
    return [
      {
        id: createMessageId(),
        role: 'assistant',
        content: [],
        toolCalls: [toolCall],
        raw: objectItem,
      },
    ];
  }

  return [
    {
      id: createMessageId(),
      role: 'user',
      content: [createRawPart(objectItem)],
      raw: objectItem,
    },
  ];
};

const normalizeInputItems = (
  request: CreateResponseRequest,
  context: PreviousConversationContext,
) => {
  const currentInput =
    typeof request.input === 'string'
      ? [request.input]
      : Array.isArray(request.input)
        ? request.input
        : [];

  return [
    ...(context.previousInputItems ?? []),
    ...(context.previousOutputItems ?? []),
    ...currentInput,
  ];
};

export const toCanonicalRequest = (
  request: CreateResponseRequest,
  context: PreviousConversationContext = {},
): CanonicalRequest => {
  const tools = expandRequestTools(request.tools ?? []);
  const inputItems = normalizeInputItems(request, context);
  const messages = inputItems.flatMap((item) =>
    toCanonicalMessage(item, tools),
  );

  if (request.instructions) {
    messages.unshift({
      id: createMessageId(),
      role: 'system',
      content: [createTextPart(request.instructions)],
    });
  }

  return CanonicalRequestSchema.parse({
    id: createResponseId(),
    model: request.model,
    instructions: request.instructions ?? undefined,
    messages,
    tools,
    toolChoice: request.tool_choice,
    parallelToolCalls: request.parallel_tool_calls ?? true,
    reasoning: request.reasoning
      ? {
          effort: request.reasoning.effort ?? undefined,
          summary: request.reasoning.summary,
        }
      : undefined,
    stream: request.stream ?? false,
    background: request.background ?? false,
    include: toStringArray(request.include),
    metadata: request.metadata ?? {},
    maxOutputTokens: request.max_output_tokens ?? undefined,
    maxToolCalls: request.max_tool_calls ?? undefined,
    previousResponseId: request.previous_response_id ?? null,
    temperature: request.temperature ?? undefined,
    topP: request.top_p ?? undefined,
    store: request.store,
    serviceTier: request.service_tier ?? undefined,
    text: request.text,
    truncation: request.truncation ?? 'disabled',
    raw: request,
  });
};

import { createFunctionCallId } from '@/lib/ids';
import type { CanonicalTool } from '@/models/canonical/tool';

/**
 * ### getItemStatus
 * Responses API 出力アイテムの status を安全に取り出す。欠損時は "completed" 扱い
 */
export const getItemStatus = (item: Record<string, unknown>): string =>
  typeof item.status === 'string' ? item.status : 'completed';

/**
 * ### getItemId
 * Responses API 出力アイテムの id を取り出す。欠損時は fallback(呼び出し側で生成した ID)
 */
export const getItemId = (
  item: Record<string, unknown>,
  fallback: string = createFunctionCallId(),
): string => (typeof item.id === 'string' ? item.id : fallback);

// itemType("function_call"/"custom_tool_call"/"mcp_call" 等)から canonical tool種別を推論する
const inferToolTypeFromItemType = (
  itemType: string,
): CanonicalTool['type'] => {
  if (itemType === 'mcp_call') return 'mcp';
  if (itemType === 'custom_tool_call') return 'custom';
  if (itemType === 'function_call') return 'function';
  return 'builtin';
};

// itemType が何らかの *_call 形状かの判定(tool_call 系 output 判別用)
export const isToolCallLikeType = (itemType: string): boolean => {
  if (!itemType) return false;
  return (
    itemType === 'custom_tool_call' ||
    itemType === 'mcp_call' ||
    itemType.endsWith('_call')
  );
};

/**
 * ### resolveTool
 * tools 登録表から name(or wireName) 一致で tool を引く。
 * 未登録の場合は itemType から型を推論した placeholder tool を生成して返す(mcp/custom/builtin の未宣言受入用)
 */
export const resolveTool = (
  tools: readonly CanonicalTool[],
  name: string,
  itemType: string,
): CanonicalTool =>
  tools.find((tool) => tool.name === name || tool.wireName === name) ?? {
    id: createFunctionCallId(),
    type: inferToolTypeFromItemType(itemType),
    name,
    wireName: name,
    originalType: itemType,
    raw: {
      type: itemType,
      name,
    },
  };

import { countMatches } from '@/lib/text';

// apply_patch や tool_call tag 等、上流モデル出力が途中で途切れたかを判定するためのパターン群。
// max_tokens 等で打ち切られた場合、閉じタグ/終端マーカーが欠ける。
// その場合は incompleteDetails.reason="upstream_truncated" を付与し呼び出し側へ伝播する
const PATCH_END_RE = /\*\*\*\s*End Patch\s*$/;
const CODE_FENCE_RE = /```/g;
const TOOL_OPEN_RE = /<tool_call>/g;
const TOOL_CLOSE_RE = /<\/tool_call>/g;

const hasUnclosedCodeFence = (text: string) =>
  countMatches(text, CODE_FENCE_RE) % 2 === 1;

const hasUnclosedToolCall = (text: string) =>
  countMatches(text, TOOL_OPEN_RE) > countMatches(text, TOOL_CLOSE_RE);

const hasUnclosedPatch = (text: string) =>
  text.includes('*** Begin Patch') && !PATCH_END_RE.test(text.trimEnd());

/**
 * ### needsUpstreamContinuation
 * 上流応答テキストが未完(途切れ)と見なせるかを判定する
 *
 * @param text - 上流モデルの出力テキスト
 * @returns 何らかの未完了兆候(未閉鎖 patch / code fence / tool_call tag / 行末カンマ等)があれば true
 */
export const needsUpstreamContinuation = (text: string): boolean => {
  const trimmed = text.trimEnd();

  if (!trimmed) {
    return false;
  }

  if (hasUnclosedPatch(trimmed)) {
    return true;
  }

  if (hasUnclosedCodeFence(trimmed)) {
    return true;
  }

  if (hasUnclosedToolCall(trimmed)) {
    return true;
  }

  // 行末が開き括弧・コロン・カンマで終わる場合も JSON や配列の途切れとみなす
  return /[[{(,:]$/.test(trimmed);
};

const PATCH_END_RE = /\*\*\*\s*End Patch\s*$/;
const CODE_FENCE_RE = /```/g;
const TOOL_OPEN_RE = /<tool_call>/g;
const TOOL_CLOSE_RE = /<\/tool_call>/g;

const countMatches = (text: string, pattern: RegExp) =>
  Array.from(text.matchAll(pattern)).length;

const hasUnclosedCodeFence = (text: string) =>
  countMatches(text, CODE_FENCE_RE) % 2 === 1;

const hasUnclosedToolCall = (text: string) =>
  countMatches(text, TOOL_OPEN_RE) > countMatches(text, TOOL_CLOSE_RE);

const hasUnclosedPatch = (text: string) =>
  text.includes('*** Begin Patch') && !PATCH_END_RE.test(text.trimEnd());

export const needsUpstreamContinuation = (text: string) => {
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

  return /[{[(,:]$/.test(trimmed);
};

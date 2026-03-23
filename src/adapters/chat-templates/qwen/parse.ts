import { safeJsonParse } from '@/utils/json';

export type ParsedQwenToolCall = {
  name: string;
  arguments: unknown;
  rawArguments?: string;
};

export type ParsedQwenResponse = {
  text: string;
  reasoningText?: string;
  toolCalls: ParsedQwenToolCall[];
};

const extractTagContents = (value: string, tagName: string) => {
  const regex = new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, 'g');
  const matches: string[] = [];

  let match: RegExpExecArray | null = regex.exec(value);
  while (match) {
    matches.push((match[1] ?? '').trim());
    match = regex.exec(value);
  }

  return matches;
};

const stripTags = (value: string, tagName: string) =>
  value
    .replace(new RegExp(`<${tagName}>[\\s\\S]*?<\\/${tagName}>`, 'g'), '')
    .trim();

export const parseQwenResponseContent = (
  content: string,
): ParsedQwenResponse => {
  const reasoningChunks = extractTagContents(content, 'think');
  const toolCallChunks = extractTagContents(content, 'tool_call');
  const contentWithoutReasoning = stripTags(content, 'think');
  const text = stripTags(contentWithoutReasoning, 'tool_call').trim();

  return {
    text,
    reasoningText: reasoningChunks.join('\n').trim() || undefined,
    toolCalls: toolCallChunks.map((chunk) => {
      const parsed = safeJsonParse<Record<string, unknown>>(chunk);

      return {
        name: typeof parsed?.name === 'string' ? parsed.name : 'unknown_tool',
        arguments: parsed?.arguments ?? chunk,
        rawArguments:
          typeof parsed?.arguments === 'string' ? parsed.arguments : chunk,
      };
    }),
  };
};

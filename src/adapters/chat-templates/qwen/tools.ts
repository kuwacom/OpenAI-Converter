import type { CanonicalRequest } from '@/models/canonical/response';
import type { CanonicalTool } from '@/models/canonical/tool';

const toToolSpec = (tool: CanonicalTool) => {
  if (tool.type === 'mcp') {
    return {
      name: tool.wireName,
      description:
        tool.description ??
        `Placeholder MCP tool router for ${tool.name}. Pass the target tool_name and input.`,
      parameters: tool.parameters ?? {
        type: 'object',
        properties: {
          tool_name: { type: 'string' },
          input: { type: 'object' },
        },
        required: ['tool_name'],
      },
    };
  }

  return {
    name: tool.wireName,
    description: tool.description ?? tool.name,
    parameters: tool.parameters ?? {
      type: 'object',
      properties: {},
    },
  };
};

const renderToolChoiceInstructions = (request: CanonicalRequest) => {
  const toolChoice = request.toolChoice;

  if (!toolChoice) {
    return '';
  }

  if (toolChoice === 'none') {
    return 'Do not call any tools. Answer directly.';
  }

  if (toolChoice === 'required') {
    return 'You must call at least one tool before you answer.';
  }

  if (
    typeof toolChoice === 'object' &&
    toolChoice !== null &&
    'name' in toolChoice &&
    typeof toolChoice.name === 'string'
  ) {
    return `You must call the tool "${toolChoice.name}" before you answer.`;
  }

  return '';
};

export const buildQwenToolSystemPrompt = (
  request: CanonicalRequest,
  tools: CanonicalTool[],
) => {
  if (tools.length === 0) {
    return '';
  }

  const instructions = [
    'You are operating in a Qwen-style ChatML tool-calling environment.',
    'When you decide to use a tool, emit one or more <tool_call>...</tool_call> blocks containing JSON.',
    'Each <tool_call> block must contain an object with "name" and "arguments".',
    request.parallelToolCalls
      ? 'Parallel tool calls are allowed. You may emit multiple <tool_call> blocks in a single assistant turn.'
      : 'Emit at most one <tool_call> block in a single assistant turn.',
    'If no tool is needed, answer normally.',
    renderToolChoiceInstructions(request),
    '<tools>',
    JSON.stringify(
      tools.map((tool) => toToolSpec(tool)),
      null,
      2,
    ),
    '</tools>',
  ].filter(Boolean);

  return instructions.join('\n\n');
};

export const renderQwenToolResponse = (content: string) =>
  `<tool_response>\n${content}\n</tool_response>`;

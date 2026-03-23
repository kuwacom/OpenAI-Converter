import { renderQwenChatTemplate } from '@/adapters/chat-templates/qwen/render';
import { parseQwenResponseContent } from '@/adapters/chat-templates/qwen/parse';

export {
  buildQwenToolSystemPrompt,
  renderQwenToolResponse,
} from '@/adapters/chat-templates/qwen/tools';
export { parseQwenResponseContent } from '@/adapters/chat-templates/qwen/parse';
export { renderQwenChatTemplate } from '@/adapters/chat-templates/qwen/render';

export const qwenChatTemplate = {
  provider: 'qwen',
  render: renderQwenChatTemplate,
  parse: parseQwenResponseContent,
};

import type {
  CanonicalRequest,
  CanonicalTool,
} from '@/models/canonical/response';
import type { LlamaCppChatCompletionMessage } from '@/models/llamacpp/chat-completions';

export type ChatTemplateRenderContext = {
  request: CanonicalRequest;
  tools: CanonicalTool[];
};

export type ChatTemplateRenderResult = {
  messages: LlamaCppChatCompletionMessage[];
  promptPreview: string;
};

export interface ChatTemplateAdapter {
  readonly provider: string;
  render(context: ChatTemplateRenderContext): ChatTemplateRenderResult;
}

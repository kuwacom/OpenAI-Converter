import { openAICompatibleResponsesBackend } from '@/backends/openai-compatible/responses/execute';
import { llamaCppQwenBackend } from '@/backends/llamacpp/qwen/execute';

export const backendRegistry = [
  llamaCppQwenBackend,
  openAICompatibleResponsesBackend,
];

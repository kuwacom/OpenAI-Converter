import { openAICompatibleChatCompletionsBackend } from '@/backends/chatCompletionsBackend';
import { openAICompatibleResponsesBackend } from '@/backends/nativeResponsesBackend';

// 登録順序は resolveBackend の選択とは無関係(id 一致で引く)
// 新規追加の汎用 Chat Completions 変換バックエンドを既定とする。
export const backendRegistry = [
  openAICompatibleChatCompletionsBackend,
  openAICompatibleResponsesBackend,
];

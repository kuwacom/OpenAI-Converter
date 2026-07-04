// OpenAI Responses 互換 proxy の識別名(tslog name 等)に使う
export const APP_NAME = 'OpenAI-Converter';

// tool loop 実行時のデフォルト上限
// request.maxToolCalls 未指定時にこの値で打ち切り、incompleteDetails.reason="max_tool_calls_exceeded" を返す
export const DEFAULT_MAX_TOOL_CALLS = 8;

// OpenAI Responses 互換 proxy の識別名(tslog name 等)
export const APP_NAME = 'OpenAI-Converter';

export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_PORT = 3000;
export const DEFAULT_CORS_ORIGIN = '*';

// 上流ベースURLは `/v1` を含む形(http(s)://host/v1)を期待する。
// 既定値は openai 公式だが実際の利用時には UPSTREAM_BASE_URL 経由で差し替えること
export const DEFAULT_UPSTREAM_BASE_URL = 'https://api.openai.com/v1';
export const DEFAULT_UPSTREAM_MODEL = '';

export const DEFAULT_BACKEND = 'openai-compatible-chat-completions';
export const DEFAULT_LOG_LEVEL = 'info';

// tool loop 実行時のデフォルト上限。
// request.maxToolCalls 未指定時にこの値で打ち切り、incompleteDetails.reason="max_tool_calls_exceeded" を返す
export const DEFAULT_MAX_TOOL_CALLS = 8;
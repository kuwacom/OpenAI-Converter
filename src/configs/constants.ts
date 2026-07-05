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

// --- ビルトイン web_search(SearXNG 経由)既定値群 ---
// 未指定時 fallback。空文字で無効化扱いとするため空文字既定を採用する
export const WEB_SEARCH_SEARXNG_BASE_URL = '';
// `<query>` プレースホルダ使用可否で柔軟に SearXNG 互換エンドポイントへ接続可能
export const WEB_SEARCH_SEARXNG_QUERY_URL = '';
export const WEB_SEARCH_SEARXNG_LANGUAGE = 'ja-JP';
// X-Real-IP ヘッダー偽装値(SearXNG 側の地域判別制御向け)
export const WEB_SEARCH_SEARXNG_CLIENT_IP = '';
export const WEB_SEARCH_USER_AGENT =
  'Mozilla/5.0 (compatible; OpenAIConverterProxy/1.0; +https://github.com/local)';

// search_context_size ごとの検索件数上限/ページ取得上限
export const WEB_SEARCH_DEFAULT_LIMIT = 10;
export const WEB_SEARCH_MAX_LIMIT = 25;
export const WEB_SEARCH_FETCH_MAX_PAGES_PER_CALL = 5;

// 検索/取得タイムアウト(ms)
export const WEB_SEARCH_TIMEOUT_MS = 15_000;
export const WEB_SEARCH_FETCH_TIMEOUT_MS = 20_000;

// fetchPage 本体上限(バイト)とテキスト抽出文字数上限
export const WEB_SEARCH_FETCH_MAX_BYTES = 1_500_000;
export const WEB_SEARCH_EXTRACT_CHAR_LIMIT = 4_000;

// logger debug 表示用打切り閾値
export const DEBUG_MAX_CHARS = 2_048;

// env 既定ユーザ位置情報群。全て空なら resolveDefaultUserLocation は null を返す
export const WEB_SEARCH_DEFAULT_USER_LOCATION_TYPE = '';
export const WEB_SEARCH_DEFAULT_USER_LOCATION_CITY = '';
export const WEB_SEARCH_DEFAULT_USER_LOCATION_REGION = '';
export const WEB_SEARCH_DEFAULT_USER_LOCATION_COUNTRY = '';
export const WEB_SEARCH_DEFAULT_USER_LOCATION_TIMEZONE = '';

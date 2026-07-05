/**
 * # Web Search Built-in Tool Types
 *
 * proxy 内蔵ビルトイン web_search ツール用の型一式。
 * upstream には存在しないためプロキシ主導で SearXNG 経由検索を実行する。
 */

export type WebSearchActionType = 'search' | 'open_page' | 'find_in_page';

export type WebSearchContextSize = 'low' | 'medium' | 'high';

/** リクエスト起点または環境既定値由来のユーザ位置情報 */
export interface WebSearchUserLocation {
  type?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
  timezone?: string | null;
}

/** リクエスト受領した未加工生設定値 */
export interface WebSearchToolConfig {
  /** 元々の built-in 宣言種別("web_search"/"web_search_preview" 含む系譜) */
  rawToolType: string | null;
  searchContextSize: WebSearchContextSize;
  externalWebAccess: boolean;
  allowedDomains: string[];
  userLocation: WebSearchUserLocation | null;
  /**
   * 検索語補強に位置情報を使う出所区分。env 既定混入回避のため保持(null=使用しない)
   */
  userLocationSource: 'request' | 'default' | null;
}

/** upstream LLM 出力の引数 payload 正規化形 */
export interface WebSearchCallPayload {
  action: WebSearchActionType;
  query: string | null;
  queries: string[] | null;
  url: string | null;
}

/** SearXNG 出力個別情報や fetchPage 復元データ共通形 */
export interface WebSearchSourceRecord {
  id: string;
  url: string;
  title: string;
  snippet: string;
  excerpt: string;
  siteName: string | null;
}

/** action.sources 補助素材列表面用 */
export interface WebSearchActionSource {
  type: 'url';
  source_id: string;
  url: string;
  title: string;
}

/** source ID 付き参照管理マップ(S1, S2, ... 採番) */
export type WebSearchSourceRegistry = Map<string, WebSearchSourceRecord>;

/** 関数呼出単位の最終実行結果 */
export interface WebSearchExecutionResult {
  action: { type: WebSearchActionType } & Record<string, unknown>;
  /** upstream テデルへ tool result として再投入する合成テキスト */
  modelInputText: string;
  sources: WebSearchSourceRecord[];
}

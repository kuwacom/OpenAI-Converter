# OpenAI-Converter

OpenAI Responses API 互換エンドポイントを提供し、Chat Completions 形式しか持たない上流 LLM API へ変換する Proxy です。  
Hono を採用し、Node.js 実行と Cloudflare Workers デプロイ双方に対応します。

最大目標は **Codex(CLI/VS Code)のネイティブ利用** です。
apply_patch 等の custom tool 往復を含む主要パターンを透過処理し、Codex が期待する Responses 形式で応答します。

## 現在の対応

### エンドポイント

| Method | Path | 概要 |
| --- | --- | --- |
| POST | `/v1/responses` | Response 作成(非stream/SSE/background) |
| GET | `/v1/responses/:responseId` | 保存済み Response 取得 |
| POST | `/v1/responses/:responseId/cancel` | バックグラウンド実行キャンセル |
| GET | `/v1/responses/:responseId/input_items` | 入力アイテム一覧 |
| GET | `/v1/health` | 生存確認 |

詳細は [docs/api.md](docs/api.md) を参照してください。

### 変換機能

- text messages / function calling / freeform custom tool の互換表現
- custom tool 引数(`{"input":"<raw>"}` ラップ)の往復安全化(Codex apply_patch 等の first-line 検証通過用)
- `tool_choice` / `parallel_tool_calls` 受理保持
- reasoning 受理 + think タグ解析合成
- built-in tools / MCP tools / namespace tools の placeholder 化(requestToCanonical 参照)
- 出力途切れ検出(`*** Begin Patch` 未閉じ等)と `incompleteDetails.reason="upstream_truncated"` 付与
- SSE streaming / background 実行とメモリ内 polling / include フィールド保持
- abort/cancel 安全化(node.ts グローバルハンドラで AbortError を正常系扱い)

## クイックスタート

```bash
git clone <repo>
cd OpenAI-Converter
npm install
cp .env.example .env   # 必要項目(UPSTREAM_BASE_URL 等)を編集
npm run dev            # tsx watch src/node.ts -> http://127.0.0.1:3000
```

クライアント(codex CLI 等)からは `OPENAI_BASE_URL=http://127.0.0.1:3000/v1` として利用できます。

本番ビルド・起動:

```bash
npm run build && npm run start
```

品質検査:

```bash
npm run typecheck   # tsc --noEmit(local tsc 5.9 使用・必ずこちらを使う)
npm run lint        # eslint . --max-warnings=0
npm test            # vitest run
```

## 設定

環境入力は Node/Workers 双方で同一キーを使用します。Zod スキーマ(`src/schemas/envSchema.ts`)経由で型付き `AppConfig` を構築します。
全項目の一覧は [.env.example](.env.example) および [docs/configuration.md](docs/configuration.md) を参照してください。

主な項目:

| キー | 既定値 | 説明 |
| --- | --- | --- |
| `UPSTREAM_BASE_URL` | `https://api.openai.com/v1` | 上流 LLM API ベースURL(`/v1` 含む前提) |
| `UPSTREAM_MODEL` | (空) | 上流モデル名。空なら request.model 軸由 |
| `UPSTREAM_API_KEY` | (空文字) | 上流認証 Bearer トークン(外部API利用時必須) |
| `DEFAULT_BACKEND` | `openai-compatible-chat-completions` | backend ID |

## バックエンド選択

バックエンドは ID 文字列で解決します。

- `openai-compatible-chat-completions`(既定): 上流が `/v1/chat/completions` 形式の場合の変換バックエンド
- `openai-compatible-responses`: 上流自体がネイティブ Responses API を持つ場合のほぼパススルー用途

## アーキテクチャ概要

```
リクエスト(OpenAI Responses形式)
    │
    ▼ routes/v1/responses/post.ts(Zod safeParse)
createResponseService ── prepareExecution(previous_response_id 文脈 + resolveBackend)
    │
    ├─ openai-compatible-chat-completions backend 経由:
    │     requestToCanonical → mapToChatCompletions → upstream fetch →
    │       chatCompletionsResponseMapper → canonicalToResponse → OpenAI Response 出力
    │
    └─ openai-compatible-responses backend 経由:
          upstreamResponsesClient パススルー → canonicalToResponse 出力

stream=true      : createStreamingResponse(SSE 経由配信)
background=true   : responseStoreService メモリ内格納+ポーリング
```

## プロジェクトディレクトリ構成

```text
src/
  adapters/         requestToCanonical / canonicalToResponse / upstreamResponseToCanonical
  apiClient/        chatCompletionsClient / responsesClient(fetch ラッパ)
  backends/         chatCompletionsBackend(+RequestMapper/ResponseMapper) / nativeResponsesBackend
  configs/          constants / env(getAppConfig Zod パース)
  lib/              apiError / customToolInput / ids / jsonUtils / object /
                    responseItem / sseStream / text (ユーティリティ群)
  middleware/       errorHandler / logger
  models/canonical/ content / index / message / response / tool + chatCompletionsModel / responsesModel
  routes/v1/        health/[get] responses/[post,[responseId]/cancel,get,inputItems]
                    fallback(index/all)
  schemas/          zod スキーマ(env/message/request/response/responses/tool/content/chatCompletions)
  services/backends/ registry / resolveBackend
  services/proxy/   createResponseService / responseStoreService / sseEventBuilder /
                    tooling(executeToolLoop)/ upstreamContinuationService
  types/            backend / common / env(AppBindings/AppEnv/AppConfig) / errors(HttpError)
test/adapters/, test/backends/, test/routes/, test/services/(vitest)

docs/api.md, docs/configuration.md
AGENTS.md, MEMORY.md(進捗メモリ), .env.example, wrangler.toml(Workers 用設定)
tsup.config.ts, vitest.config.ts, tsconfig.json(@/* エイリアス・strict:true)
```

## Cloudflare Workers デプロイ

```bash
npm run dev:worker    # wrangler dev ローカル開発
npm run check:worker  # wrangler deploy --dry-run
npm run deploy:worker # wrangler deploy 本番デプロイ
```

シークレット値(`UPSTREAM_API_KEY`)は `.dev.vars`(ローカル)/ Secrets(本番) 経由で注入してください。Workers 固有設定は `wrangler.toml` を参照してください。

## 注意事項・既知残課題

- builtin web_search 再現未実装(SearXNG/DuckDuckGo HTML 実行層の TS 移植想定・env 未設定時 stub fallback 付)
- streaming での function_call_arguments.delta/reasoning delta 配信未対応(最終レスポンス組立後に一括配信中)
- namespace ツール群の子関数フラット化 placeholder 扱い(ネスト関数の実際実行は今後課題)
- background store ・ abortController はプロセス内メモリのため再起動で揮発する

## 開発参考資料

OpenAI 公式仕様:
https://developers.openai.com/api/reference/resources/responses/methods/create/

function calling カイド(function/custom/builtin/MCP):
https://developers.openai.com/api/docs/guides/function-calling/

tools/connectors/MCP カイド(approval フロー含む):
https://developers.openai.com/api/docs/guides/tools-connectors-mcp/
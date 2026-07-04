# OpenAI-Converter

OpenAI Responses API と、function calling や tool semantics を持たない、または一部しか持たない LLM API の間をつなぐ変換 Proxy です。
Hono REST API テンプレート構成を採用し、Node.js 実行と Cloudflare Workers デプロイ双方に対応します。

初期実装は次を前提にしています。

- 公開 API: OpenAI Responses 互換
- バックエンド: llama.cpp server
- モデル: Qwen 系
- Chat Template: ChatML / Qwen tool-calling style

## 目的

- OpenAI Responses API の入力を受ける
- canonical model に正規化する
- Qwen ChatML / llama.cpp chat completions に変換する
- 返却を OpenAI Responses 互換の output item に再構築する

## 現在の対応

- POST `/v1/responses`
- GET `/v1/responses/:responseId`
- POST `/v1/responses/:responseId/cancel`
- GET `/v1/responses/:responseId/input_items`
- text messages / function calling / freeform custom tool の互換表現
- built-in tools / MCP tools の placeholder item
- tool_choice / parallel_tool_calls
- reasoning の受理と Qwen think 解析
- SSE streaming / background 実行とメモリ内 polling / include フィールドの保持

## OpenAI docs / 実装方針

Responses API create パラメータでは background include parallel_tool_calls reasoning stream tool_choice tools が定義されています。
公式 POST /v1/responses OpenAPI 例では built-in tools MCP tools function calls background mode streaming SSE 受け付けが確認できます:

https://developers.openai.com/api/reference/resources/responses/methods/create/

Function calling ガイドでは function tool に加え freeform custom tool と OpenAI 提供 built-in tool があることが説明されています:

https://developers.openai.com/api/docs/guides/function-calling/

MCP / connector ガイドでは remote MCP server と connector へ approval フローが説明されています:

https://developers.openai.com/api/docs/guides/tools-connectors-mcp/

Qwen3 一次資料では ChatML ベース tool calling start_end_result_think 利用並列 multi-step tool call サポート説明されています。Qwen3.5 を系譜とみなし初期実装しています:

https://qwen.readthedocs.io/en/latest/getting_started/concepts.html

## セットアップ

`.env.example` をコピーして `.env` を作成してください。
`LOG_LEVEL` には `debug` `info` `warn` `error` 等を指定できます。

## Node.js で起動

開発:

```bash
npm install
npm run dev
```

本番ビルド:

```bash
npm run build && npm run start
```

lint / format / test:

```bash
npm run lint
npm run format
npm run test
```

## Cloudflare Workers で起動/デプロイ

ローカル開発:

```bash
npm run dev:worker
```

deploy:

```bash
npm run deploy:worker
```

dry-run 検証:

```bash
npm run check:worker
```

secret 扱い値(`OPENAI_COMPATIBLE_BASE_URL` 等)は .dev.vars 等与えてください。

## 注意

- built-in tools/MCP tools は placeholder item までです
- background store はメモリ内です
- llama.cpp 側機能差により一部フィールド受理保持のみです

## プロジェクトディレクトリ構成

```text
src/
  adapters/
    chat-templates/
      qwen/
    openai-responses/
  api/
    llamacpp/
      v1/
        chat/
    openai-compatible/
      v1/
  backends/
    llamacpp/
      qwen/
    openai-compatible/
      responses/
  configs/
  lib/
  middleware/
  models/
    canonical/
    llamacpp/
    openai/
  routes/
    v1/
      health/
      responses/
        [responseId]/
  schemas/
    canonical/
    config/
    llamacpp/
    openai/
  services/
    backends/
    proxy/
  types/
  utils/

test/

※ setup 手順(npm run dev/build/lint/format/test 等)および Workers デプロイ(npm run dev:worker/check:worker/deploy:worker/start)は本リポジトリ package.json scripts 経由ですべて提供されます 上流 docs URL 群は本文中 OpenAI docs 節に列挙しています
```

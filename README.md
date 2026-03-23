# OpenAI-Converter

OpenAI Responses API と、function calling や tool semantics を持たない、または一部しか持たない LLM API の間をつなぐ変換 Proxy です。

初期実装は次を前提にしています。

- 公開 API: OpenAI Responses 互換
- バックエンド: `llama.cpp server`
- モデル: Qwen 系
- Chat Template: ChatML / Qwen tool-calling style

## 目的

- OpenAI Responses API の入力を受ける
- canonical model に正規化する
- Qwen ChatML / llama.cpp chat completions に変換する
- 返却を OpenAI Responses 互換の output item に再構築する

## 現在の対応

- `POST /v1/responses`
- `GET /v1/responses/:responseId`
- `POST /v1/responses/:responseId/cancel`
- `GET /v1/responses/:responseId/input_items`
- text messages
- function calling
- freeform custom tool の互換表現
- built-in tools の placeholder item
- MCP tools の placeholder item
- `tool_choice`
- `parallel_tool_calls`
- `reasoning` の受理と Qwen `<think>` 解析
- SSE streaming
- background 実行とメモリ内 polling
- `include` フィールドの保持

## 設計メモ

- `src/models`: 構造を持つ model/schema
- `src/types`: 非構造の型
- `src/api`: 外部 API 呼び出し
- `src/adapters/chat-templates/<provider>`: ChatTemplate 依存の変換

## OpenAI docs / 実装方針

Responses API の create パラメータでは、`background`、`include`、`parallel_tool_calls`、`reasoning`、`stream`、`tool_choice`、`tools` が定義されています。

公式の `POST /v1/responses` OpenAPI 例では、Responses API が built-in tools、MCP tools、function calls、background mode、streaming SSE を受け付けることが確認できます:

- https://developers.openai.com/api/reference/resources/responses/methods/create/

Function calling ガイドでは、function tool に加えて freeform の custom tool と、OpenAI 提供の built-in tool があることが説明されています:

- https://developers.openai.com/api/docs/guides/function-calling/

MCP / connector ガイドでは、remote MCP server と connector に対する approval フローが説明されています:

- https://developers.openai.com/api/docs/guides/tools-connectors-mcp/

Qwen3 の一次資料では、ChatML ベースの tool calling が `<tool_call>` / `<tool_response>` / `<think>` を使うこと、並列 tool call と multi-step tool call をサポートすることが説明されています。Qwen3.5 はこの系譜とみなして初期実装しています。

- https://qwen.readthedocs.io/en/latest/getting_started/concepts.html

## セットアップ

```bash
npm install
npm run dev
```

## 注意

- built-in tools と MCP は初期実装では placeholder item までです
- background store はメモリ内です
- llama.cpp 側の機能差により、一部フィールドは受理して保持するのみです

# API リファレンス

OpenAI-Converter は **OpenAI Responses API 互換** のエンドポイントを公開します。
クライアント(codex CLI を含む)は `https://api.openai.com/v1` と同形式でリクエストを送れます。

## エンドポイント

### POST `/v1/responses`
Responses 作成。非ストリーミング・ストリーミング(SSE)双方対応。
- `stream: true` なら SSE として `response.created → response.in_progress → response.output_item.added → response.content_part.added → response.output_text.delta* → response.output_text.done → ... → response.completed` を流す
- `background: true` なら即座に `status: in_progress` を返し、メモリ内 store へ格納してポーリングさせる
- tool loop は backend 側で完結(後述)

### GET `/v1/responses/:responseId`
保存済み Response を取得。未存在時は 404。

### POST `/v1/responses/:responseId/cancel`
バックグラウンド実行をキャンセル。abortController 経由で中断する。

### GET `/v1/responses/:responseId/input_items`
当該 Response の入力アイテム一覧をリスト形式で返す。

### GET `/v1/health`
生存確認。`{ status: "ok" }` を返す。

## 入力 input 形式

`input` は文字列・文字列配列・アイテムオブジェクト配列のいずれか。
codex 等、Responses ネイティブクライアントが送る代表的な出力アイテムは次のとおり:

- `message`(role/content)
- `function_call` / `function_call_output`
- `custom_tool_call` / `custom_tool_call_output`
- `mcp_call` / `mcp_approval_response`
- `reasoning`

正規化ロジックは `src/adapters/requestToCanonical.ts` 参照。

## tools 取扱い

- `function`: 標準 OpenAI 関数ツール。上流 CC `tools[].type=function` へそのまま渡す
- `custom`: 単一文字列入力ラッパーへ変換し、応答側で元の custom 形式へ復元
- `mcp`: placeholder ブリッジ(`mcp_<index>` wireName)。実 MCP 実行は今後課題
- `builtin`(web_search 等): placeholder item 化。本家再現は今後課題

tool loop 実装は `src/services/proxy/tooling.ts#executeToolLoop`:
1. 応答 output 内の tool_call を抽出
2. assistant + tool result メッセージを追加して上流へ再要求
3. `max_tool_calls`(既定8) 超過時は `incomplete_details.reason="max_tool_calls_exceeded"` で打ち切る

## apply_patch(Codex 用途)途切れ検出

Chat Completions 上流の LLM 出力が途中で途切れた場合でも codex 連携を維持するため、
`src/services/proxy/upstreamContinuationService.ts` が以下を検知します:

- `*** Begin Patch` 以降に `*** End Patch` がない
- 未閉じのコードフェンス(``` 数奇数)
- 未閉じ `<tool_call>` タグ
- 末尾が区切り文字 `, : [ { (` 等で止まっている

いずれかに該当する場合、canonical 応答へ `incompleteDetails.reason="upstream_truncated"` を付与します。

## ストリーミング

SSE イベント順序(create-response.service.ts#createStreamingResponse):
1. `response.created`
2. `response.in_progress`
3. `response.output_item.added`(message item, in_progress)
4. `response.content_part.added`
5. `response.output_text.delta`(繰返し)
6. `response.output_text.done` / `response.content_part.done`
7. 追加 output アイテム群(関数呼び出しなど)の added/done
8. `response.completed`

backend.stream 未定義時は non-streaming execute 結果を最後に一度だけ流すフォールバック動作になります。

## エラー

全ルート例外は `src/middleware/errorHandler.ts` で集約し、OpenAI 風 JSON 形式へ包んで返却します:
```json
{ "error": { "message": "...", "type": "...", "code": ..., "param": null } }
```
# 設定リファレンス

OpenAI-Converter は Node.js(`@hono/node-server`) と Cloudflare Workers 双方で動作します。
環境入力は両環境で同一キーを取り扱い、`getAppConfig` が Zod でパースして `AppConfig` へ統一します。

## 環境変数一覧

| キー | 必須 | 既定値 | 説明 |
| --- | --- | --- | --- |
| `HOST` | - | `127.0.0.1` | Node 実行時のリッスンホスト(Workers では無視) |
| `PORT` | - | `3000` | Node 実行時のリッスンポート(Workers では wrangler 側) |
| `CORS_ORIGIN` | - | `*` | CORS 送信元。本番では具体ドメインを推奨 |
| `UPSTREAM_BASE_URL` | ※1 | `https://api.openai.com/v1` | 上流 LLM API ベースURL(`/v1` 含む前提) |
| `UPSTREAM_MODEL` | - | (空) | 上流へ送るモデル名。空なら request.model を転送 |
| `UPSTREAM_API_KEY` | ※2 | (空文字) | 上流認証用 Bearer トークン |
| `DEFAULT_BACKEND` | - | `openai-compatible-chat-completions` | バックエンドID |
| `LOG_LEVEL` | - | `info` | silly / trace / debug / info / warn / error / fatal |

※1 既定値は OpenAI 公式だが、外部モデル利用時は必ず上書きすること
※2 外部 API 利用時は必須。ハードコードせず環境変数経由で注入する

## バックエンド選択

バックエンドは ID 文字列で解決します(登録順序は選択に関与しない)。

### `openai-compatible-chat-completions`(既定)
- Chat Completions 形式(`/v1/chat/completions`)しか持たない上流向けの変換バックエンド
- Responses リクエスト → canonical → CC メッセージ配列 へ展開、応答を canonical → Responses 出力アイテムへ再構築
- tool loop、reasoning_content/think 解析、apply_patch 形式途切れ検出を実装

### `openai-compatible-responses`
- 上流自体がネイティブ Responses API を持つ場合のほぼパススルー用途
- background フラグは proxy 側管理のため送らない。stream は対応済み

## 実行モード

### Node.js
```bash
cp .env.example .env   # 必要項目を編集
npm install
npm run dev            # tsx watch src/node.ts
```
起動: `src/node.ts`(dotenv/config 読込後に createApp を serve)

### Cloudflare Workers
```bash
npm run dev:worker     # wrangler dev
npm run deploy:worker  # wrangler deploy
```
シークレット値(`UPSTREAM_API_KEY` 等)は `.dev.vars`(ローカル)/ Secrets(本番)経由で注入してください。
Workers 固有設定は `wrangler.toml` を参照してください。

## ログレベル

tslog ベースのロガーを使用します(`src/services/logger.ts`)。
HTTP 要求ログはミドルウェアで一元化(`src/middleware/logger.ts`)しており、 developers console.log の直接使用は避けてください。
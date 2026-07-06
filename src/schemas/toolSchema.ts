import { z } from 'zod';

export const CanonicalToolSchema = z.object({
  id: z.string(),
  type: z.enum(['function', 'custom', 'builtin', 'mcp', 'unknown']),
  name: z.string(),
  wireName: z.string(),
  // 元宣言時の親名前空間。Codex 由来の {type:"namespace",tools:[...]} を子ごとにフラット化した場合のみ設定される。
  // canonicalToResponse はこれを参照し Responses 形式 function_call へ namespace フィールドを復元する(往復整合用)
  parentNamespace: z.string().optional(),
  description: z.string().optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
  strict: z.boolean().optional(),
  originalType: z.string().optional(),
  // builtin tool 具体種別(web_search/tool_search/local_shell/image_generation)。応答復元時の *_call アイテム変換分岐キー
  builtinKind: z.enum(['web_search','tool_search','local_shell','image_generation']).optional(),
  raw: z.record(z.string(), z.unknown()),
});

export const CanonicalToolChoiceSchema = z.union([
  z.enum(['none', 'auto', 'required']),
  z.object({
    type: z.string(),
    name: z.string().optional(),
  }),
  z.record(z.string(), z.unknown()),
]);

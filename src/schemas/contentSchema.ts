import { z } from 'zod';

// OpenAI Responses API の url_citation annotation 形状。
// message content パート(text)の annotations 配列要素として使用する
export const UrlCitationAnnotationSchema = z.object({
  type: z.literal('url_citation'),
  start_index: z.number().int().nonnegative(),
  end_index: z.number().int().nonnegative(),
  url: z.string(),
  title: z.string().optional(),
});

export const CanonicalContentPartSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('text'),
    text: z.string(),
    // web_search 利用時の引用元 URL 注釈群。OpenAI 本家同様 output_text content へ付与される
    annotations: z.array(UrlCitationAnnotationSchema).optional(),
  }),
  z.object({
    type: z.literal('image'),
    imageUrl: z.string().optional(),
    detail: z.string().optional(),
    raw: z.unknown().optional(),
  }),
  z.object({
    type: z.literal('file'),
    fileId: z.string().optional(),
    fileUrl: z.string().optional(),
    raw: z.unknown().optional(),
  }),
  z.object({
    type: z.literal('reasoning'),
    text: z.string(),
  }),
  z.object({
    type: z.literal('raw'),
    raw: z.unknown(),
  }),
]);

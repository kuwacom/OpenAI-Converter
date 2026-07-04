import { z } from 'zod';

export const CanonicalContentPartSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('text'),
    text: z.string(),
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

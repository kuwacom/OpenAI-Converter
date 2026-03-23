import type { ZodTypeAny, output as ZodOutput } from 'zod';

export const validateWithSchema = <TSchema extends ZodTypeAny>(
  schema: TSchema,
  data: unknown,
): ZodOutput<TSchema> => schema.parse(data);

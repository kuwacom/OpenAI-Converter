import type { Context } from 'hono';
import { ZodError } from 'zod';
import { HttpError } from '@/types/errors';

export const handleError = (error: unknown, c: Context) => {
  if (error instanceof HttpError) {
    return new Response(
      JSON.stringify({
        error: {
          type: 'http_error',
          message: error.message,
          details: error.details ?? null,
        },
      }),
      {
        headers: {
          'content-type': 'application/json; charset=utf-8',
        },
        status: error.status,
      },
    );
  }

  if (error instanceof ZodError) {
    return c.json(
      {
        error: {
          type: 'validation_error',
          message: 'Request validation failed',
          details: error.issues,
        },
      },
      400,
    );
  }

  return c.json(
    {
      error: {
        type: 'internal_error',
        message:
          error instanceof Error ? error.message : 'Internal server error',
      },
    },
    500,
  );
};

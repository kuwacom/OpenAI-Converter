import type { Context } from 'hono';
import { ZodError } from 'zod';
import { apiError, ApiError, ErrorCode } from '@/lib/apiError';
// HttpError は instanceof で値として使うため type import にしない
import { HttpError } from '@/types/errors';
import logger from '@/services/logger';
import type { AppEnv } from '@/types/env';

/**
 * ### errorHandler
 * 例外を ApiError に変換して HTTP response に正規化する
 * ドメイン層の HttpError は status/details を維持しつつ OpenAI 互換 envelope に正規化する
 * 予期しない例外は 500 に集約する
 *
 * @param error - route で発生した例外
 * @param c - Hono コンテキスト
 * @returns エラーレスポンス
 */
export const errorHandler = (error: Error, c: Context<AppEnv>) => {
  if (error instanceof ApiError) {
    if (error.isExpected) {
      logger.warn(`ApiError: ${error.code} - ${error.message}`);
    } else {
      logger.error(`ApiError: ${error.code}`, error);
    }

    return c.json(error.toResponse(), error.statusCode);
  }

  // ドメイン層は HttpError を投げ続けるため、ここで境界変換する
  // HttpError.status は upstream の任意 HTTP status を number で持つため、
  // c.json の ContentfulStatusCode 制約を回避し new Response で status をそのまま転送する
  if (error instanceof HttpError) {
    if (error.status >= 500) {
      logger.error(`HttpError ${error.status}: ${error.message}`, error);
    } else {
      logger.warn(`HttpError ${error.status}: ${error.message}`);
    }

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

  // safeParse で弾く設計だが、parse 例外が漏れた場合の最後の砦
  if (error instanceof ZodError) {
    const validationError = apiError(ErrorCode.VALIDATION_ERROR, error.issues);
    logger.warn(
      `ApiError: ${validationError.code} - ${validationError.message}`,
    );

    return c.json(validationError.toResponse(), validationError.statusCode);
  }

  logger.error('Unexpected error', error);
  const internalError = apiError(ErrorCode.INTERNAL_SERVER_ERROR);
  return c.json(internalError.toResponse(), internalError.statusCode);
};

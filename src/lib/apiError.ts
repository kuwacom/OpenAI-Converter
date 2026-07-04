import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { ZodIssue } from 'zod';

// API レスポンスとして返せるエラーコードを一元管理する
// Hono テンプレートの ErrorCode 設計を踏襲しつつ、proxy が返す envelope は OpenAI 互換形式に寄せる
export const ErrorCode = {
  VALIDATION_ERROR: 'validation_error',
  NOT_FOUND: 'not_found',
  UNAUTHORIZED: 'unauthorized',
  FORBIDDEN: 'forbidden',
  CONFLICT: 'conflict',
  INTERNAL_SERVER_ERROR: 'internal_error',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export type ValidationErrorDetails = ZodIssue[];

type ValidationErrorResponse = {
  error: {
    type: typeof ErrorCode.VALIDATION_ERROR;
    message: string;
    details: ValidationErrorDetails;
  };
};

type ErrorResponse = {
  error: {
    type: Exclude<ErrorCode, typeof ErrorCode.VALIDATION_ERROR>;
    message: string;
    details?: unknown;
  };
};

export type ApiErrorResponse = ValidationErrorResponse | ErrorResponse;

/**
 * # ApiError
 * API レスポンスに変換できる情報を持つ共通エラー
 *
 * ### 特徴
 * - HTTP ステータスと ErrorCode を一元管理する
 * - isExpected で想定内エラーかを判定し、ログレベル判定に使う
 * - ドメイン層の HttpError とは共存し、route 層のバリデーション・分岐で使う
 */
export class ApiError extends Error {
  public readonly statusCode: ContentfulStatusCode;
  public readonly code: ErrorCode;
  public readonly details?: unknown;
  public readonly isExpected: boolean;

  public constructor(
    statusCode: ContentfulStatusCode,
    code: ErrorCode,
    message: string,
    details?: unknown,
    isExpected = true,
  ) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isExpected = isExpected;
  }

  /**
   * ### toResponse
   * クライアントへ返す OpenAI 互換エラーレスポンスを生成する
   *
   * @returns API 共通エラーレスポンス
   */
  public toResponse(): ApiErrorResponse {
    if (this.code === ErrorCode.VALIDATION_ERROR) {
      return {
        error: {
          type: ErrorCode.VALIDATION_ERROR,
          message: this.message,
          details: (this.details as ValidationErrorDetails) ?? [],
        },
      };
    }

    const base: ErrorResponse = {
      error: {
        type: this.code,
        message: this.message,
      },
    };

    if (this.details !== undefined) {
      base.error.details = this.details;
    }

    return base;
  }
}

// ErrorCode ごとに受け取れる引数を固定し、補完と型安全を両立させる
// code に応じて必要な追加情報だけを渡せるようにして誤用を防ぐ
type ApiErrorArgs = {
  [ErrorCode.VALIDATION_ERROR]: [details: ValidationErrorDetails];
  [ErrorCode.NOT_FOUND]: [resource?: string];
  [ErrorCode.UNAUTHORIZED]: [];
  [ErrorCode.FORBIDDEN]: [];
  [ErrorCode.CONFLICT]: [message?: string];
  [ErrorCode.INTERNAL_SERVER_ERROR]: [message?: string];
};

type ApiErrorBuilderMap = {
  [K in ErrorCode]: (...args: ApiErrorArgs[K]) => ApiError;
};

// ErrorCode と ApiError の生成処理を 1 箇所に集めて message や statusCode の揺れを防ぐ
// 追加の ErrorCode が増えてもここを見ればレスポンス方針を追えるようにする
const apiErrorBuilders: ApiErrorBuilderMap = {
  [ErrorCode.VALIDATION_ERROR]: (details: ValidationErrorDetails) =>
    new ApiError(
      400,
      ErrorCode.VALIDATION_ERROR,
      'Request validation failed',
      details,
      true,
    ),
  [ErrorCode.NOT_FOUND]: (resource = 'Resource') =>
    new ApiError(
      404,
      ErrorCode.NOT_FOUND,
      `${resource} not found`,
      undefined,
      true,
    ),
  [ErrorCode.UNAUTHORIZED]: () =>
    new ApiError(401, ErrorCode.UNAUTHORIZED, 'Unauthorized', undefined, true),
  [ErrorCode.FORBIDDEN]: () =>
    new ApiError(403, ErrorCode.FORBIDDEN, 'Forbidden', undefined, true),
  [ErrorCode.CONFLICT]: (message = 'Conflict') =>
    new ApiError(409, ErrorCode.CONFLICT, message, undefined, true),
  [ErrorCode.INTERNAL_SERVER_ERROR]: (message = 'Internal server error') =>
    new ApiError(
      500,
      ErrorCode.INTERNAL_SERVER_ERROR,
      message,
      undefined,
      false,
    ),
};

/**
 * ### apiError
 * ErrorCode に対応した共通 API エラーを生成する
 *
 * @param code - エラー種別
 * @param args - ErrorCode ごとに定義された追加引数
 * @returns 共通 API エラー
 */
export function apiError<K extends ErrorCode>(
  code: K,
  ...args: ApiErrorArgs[K]
): ApiError {
  const builder = apiErrorBuilders[code];
  return builder(...args);
}

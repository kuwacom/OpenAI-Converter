export class HttpError extends Error {
  public readonly status: number;
  public readonly details?: unknown;

  public constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.details = details;
  }
}

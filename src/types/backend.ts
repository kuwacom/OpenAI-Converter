import type { AppConfig } from '@/types/env';
import type {
  CanonicalRequest,
  CanonicalResponse,
} from '@/models/canonical/response';

export type BackendExecutionContext = {
  config: AppConfig;
  signal?: AbortSignal;
};

export type BackendStreamDelta = {
  textDelta?: string;
  rawChunk?: unknown;
};

export type BackendExecuteOptions = {
  disableToolLoop?: boolean;
};

export type BackendStreamResult = {
  deltas: AsyncIterable<BackendStreamDelta>;
  finalResponse: Promise<CanonicalResponse>;
};

export interface BackendAdapter {
  readonly id: string;
  readonly provider: string;
  readonly chatTemplate: string;
  readonly wireApi: 'responses' | 'chat-completions';
  execute(
    request: CanonicalRequest,
    context: BackendExecutionContext,
    options?: BackendExecuteOptions,
  ): Promise<CanonicalResponse>;
  stream?(
    request: CanonicalRequest,
    context: BackendExecutionContext,
  ): Promise<BackendStreamResult>;
}

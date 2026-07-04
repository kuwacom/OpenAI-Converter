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
};

export type BackendExecuteOptions = {
  disableToolLoop?: boolean;
};

export type BackendStreamResult = {
  deltas: AsyncIterable<BackendStreamDelta>;
  finalResponse: Promise<CanonicalResponse>;
};

// 各 backend 実装すべき最小契約。
// chat template 概念は qwen 固有仕様だったため廃止した
export interface BackendAdapter {
  readonly id: string;
  readonly provider: string;
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

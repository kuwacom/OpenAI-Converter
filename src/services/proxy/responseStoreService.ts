import type {
  CreateResponseRequest,
  OpenAIResponse,
} from '@/models/responsesModel';
import { HttpError } from '@/types/errors';

type StoredResponseRecord = {
  request: CreateResponseRequest;
  // 元リクエスト受領時の tools 配列(生形状)。previous_response_id 経由で incremental items のみ送られてきた場合の復元用。namespace 形状や builtin 生定義を含む
  toolsRaw: unknown[];
  inputItems: unknown[];
  outputItems: unknown[];
  response: OpenAIResponse;
  abortController?: AbortController;
};

class ResponseStoreService {
  private readonly responses = new Map<string, StoredResponseRecord>();

  public save(record: StoredResponseRecord) {
    this.responses.set(record.response.id, record);
    return record;
  }

  public get(responseId: string) {
    return this.responses.get(responseId);
  }

  public getOrThrow(responseId: string) {
    const record = this.get(responseId);

    if (!record) {
      throw new HttpError(404, `Response not found: ${responseId}`);
    }

    return record;
  }

  public updateResponse(responseId: string, response: OpenAIResponse) {
    const record = this.getOrThrow(responseId);
    const updated = {
      ...record,
      outputItems: response.output,
      response,
    };

    this.responses.set(responseId, updated);

    return updated;
  }

  public setAbortController(
    responseId: string,
    abortController: AbortController,
  ) {
    const record = this.getOrThrow(responseId);
    this.responses.set(responseId, {
      ...record,
      abortController,
    });
  }

  public getConversationContext(responseId?: string | null) {
    if (!responseId) {
      return {};
    }

    const record = this.getOrThrow(responseId);

    return {
      // 前回リクエストの tools 配列(namespace/builtin 生形状含む)。previous_response_id 経由で来た場合の復元用
      previousToolsRaw: record.toolsRaw,
      previousInputItems: record.inputItems,
      previousOutputItems: record.outputItems,
    };
  }

  public cancel(responseId: string) {
    const record = this.getOrThrow(responseId);

    if (record.abortController && !record.abortController.signal.aborted) {
      record.abortController.abort();
    }

    const cancelledResponse: OpenAIResponse = {
      ...record.response,
      status: 'cancelled',
      completed_at: Math.floor(Date.now() / 1000),
      error: null,
      incomplete_details: {
        reason: 'cancelled',
      },
    };

    this.responses.set(responseId, {
      ...record,
      response: cancelledResponse,
      outputItems: cancelledResponse.output,
    });

    return cancelledResponse;
  }
}

export const responseStore = new ResponseStoreService();

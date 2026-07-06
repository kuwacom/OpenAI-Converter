import type { OpenAIResponse } from '@/models/responsesModel';
import {
  createSyntheticAssistantMessageOutput,
  getAssistantTextFromResponse,
} from '@/adapters/canonicalToResponse';

// /v1/responses のストリーミング応答で送信する SSE event 一件の形状
type SseEvent = {
  event: string;
  data: Record<string, unknown>;
};

/**
 * ### sseEncode
 * OpenAI Responses SSE 形式(event 行 + data 行 + 空行)へエンコードする
 */
export const sseEncode = (event: string, data: Record<string, unknown>) =>
  'event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n';

/**
 * ### buildStreamingEvents
 * 最終 response 確定後に Codex 等 client へ一括送信する残イベント群を構築する
 *
 * codex-rs/codex-api/src/sse/responses.rs の公式実装および
 * codex-rs/core/tests/common/responses.rs テストヘルパ(ev_function_call/ev_assistant_message)に基づく:
 *   - output_item.done 単体で item 全体(name/call_id/arguments 等)を配信すればよい
 *   - function_call_arguments.delta/done, custom_tool_call_input.delta/done は codex CLI が無視するため不要
 *   - 空テキストメッセージの done を送ると codex CLI が「テキスト応答完了」と誤認するため、function_call のみターンでは送らない
 *
 * completed ペイロードは finalResponse 全体(id/status/model/output/usage 含む)
 */
export type BuildStreamingEventsOptions = {
  // ストリーミング中に output_item.done で配信済みの reasoning を
  // response.completed ペイロードで重複配信しないために除外するフラグ
  streamedReasoning?: boolean;
};

export const buildStreamingEvents = (
  finalResponse: OpenAIResponse,
  streamedText: string,
  itemId: string,
  options?: BuildStreamingEventsOptions,
): SseEvent[] => {
  const events: SseEvent[] = [];
  const streamedReasoning = options?.streamedReasoning ?? false;

  const firstMessage = finalResponse.output.find(
    (item: Record<string, unknown>) => item.type === 'message',
  );
  const finalAssistantText =
    streamedText || getAssistantTextFromResponse(finalResponse);

  // ストリーミング中に配信済みの message output_text.done -> content_part.done -> output_item.done で閉じる
  if (finalAssistantText) {
    events.push(
      {
        event: 'response.output_text.done',
        data: {
          type: 'response.output_text.done',
          item_id: itemId,
          output_index: 0,
          content_index: 0,
          text: finalAssistantText,
        },
      },
      {
        event: 'response.content_part.done',
        data: {
          type: 'response.content_part.done',
          item_id: itemId,
          output_index: 0,
          content_index: 0,
          part: {
            type: 'output_text',
            text: finalAssistantText,
            annotations: [],
          },
        },
      },
      {
        event: 'response.output_item.done',
        data: {
          type: 'response.output_item.done',
          output_index: 0,
          item:
            firstMessage && firstMessage.type === 'message'
              ? firstMessage
              : {
                  ...createSyntheticAssistantMessageOutput(finalAssistantText),
                  id: itemId,
                },
        },
      },
    );
  }

  // 非 message アイテム(function_call/reasoning/custom_tool_call/mcp_call/web_search_call 等)を配信。
  // codex CLI 公式形式(output_item.done 単体で item 全体配信)へ従う。delta/done 系サブイベントは不要
  const nonMessageOutputs = finalResponse.output.filter(
    (output) => {
      if (finalAssistantText && output.type === 'message') return false;
      // ストリーミング中に配信済みの reasoning は除外(重複配信防止)
      if (streamedReasoning && (output as Record<string, unknown>).type === 'reasoning') return false;
      return true;
    }
  );

  // streamedReasoning の分も index を進める。reasoning 配信済みなら +1、
  // message text 配信済みならさらに +1 で後続 item の output_index が整合する
  const startIndex =
    (finalAssistantText ? 1 : 0) + (streamedReasoning ? 1 : 0);

  for (let i = 0; i < nonMessageOutputs.length; i++) {
    const item = nonMessageOutputs[i];
    if (!item) continue;

    events.push({
      event: 'response.output_item.done',
      data: {
        type: 'response.output_item.done',
        output_index: startIndex + i,
        item,
      },
    });
  }

  // 完全空応答でも最低1つの done item を要求するクライアントがあるため補完する
  if (!finalAssistantText && finalResponse.output.length === 0) {
    events.push({
      event: 'response.output_item.done',
      data: {
        type: 'response.output_item.done',
        output_index: 0,
        item: createSyntheticAssistantMessageOutput(''),
      },
    });
  }

  // 必ず最後に completed を送る
  events.push({
    event: 'response.completed',
    data: {
      type: 'response.completed',
      response: finalResponse,
    },
  });

  return events;
};

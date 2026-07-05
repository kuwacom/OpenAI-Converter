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
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

/**
 * ### buildStreamingEvents
 * 最終 response 確定後に Codex 等 client へ一括送信する残イベント群を構築する。
 *
 * 配信順序:
 * 1. assistant text を流していた場合は output_text.done -> content_part.done -> output_item.done(先頭 message)
 * 2. message 以外の output(function_call/reasoning/custom_tool_call 等)を added/done ペアで配信
 * 3. 全く出力がない場合は空の synthetic assistant message done を1つ配信
 * 4. 最後に response.completed を必ず1つ送る
 *
 * @param finalResponse - backend から受領した最終 canonical response(OpenAI 形式へ変換済み)
 * @param streamedText  - ストリーミング中に累積した visible text(delta 配信済み)。無ければ finalResponse.output から抽出
 * @param itemId        - 先頭メッセージ item id(streaming 開始時に決定した streamItemId)
 * @returns クライアントへ送る SSE events
 */
export const buildStreamingEvents = (
  finalResponse: OpenAIResponse,
  streamedText: string,
  itemId: string,
): SseEvent[] => {
  const events: SseEvent[] = [];

  const firstOutput = finalResponse.output.find(
    (item: Record<string, unknown>) => item.type === 'message',
  );
  const finalAssistantText =
    streamedText || getAssistantTextFromResponse(finalResponse);

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
            firstOutput && firstOutput.type === 'message'
              ? firstOutput
              : {
                  ...createSyntheticAssistantMessageOutput(finalAssistantText),
                  id: itemId,
                },
        },
      },
    );
  }

  // text 以外の output item(reasoning/function_call/custom_tool_call/mcp_call 等)を配信。
  // 出力 index は既に先頭 message 用に1使っている可能性があるため offset 補正する
  const nonMessageOutputs = finalResponse.output.filter(
    (output) => !(finalAssistantText && output.type === 'message'),
  );

  for (let i = 0; i < nonMessageOutputs.length; i++) {
    const outputIndex = i + (finalAssistantText ? 1 : 0);
    events.push(
      {
        event: 'response.output_item.added',
        data: {
          type: 'response.output_item.added',
          output_index: outputIndex,
          item: nonMessageOutputs[i],
        },
      },
      {
        event: 'response.output_item.done',
        data: {
          type: 'response.output_item.done',
          output_index: outputIndex,
          item: nonMessageOutputs[i],
        },
      },
    );
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

  // 必ず最後に completed を送り、client 側で終端判定可能にする
  events.push({
    event: 'response.completed',
    data: {
      type: 'response.completed',
      response: finalResponse,
    },
  });

  return events;
};

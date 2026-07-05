// 文字列から JSON を取り出して safeParse するヘルパ群。
// LLM 出力には code fence や前後ノイズが混じるため、複数候補を順に試行する

const stripCodeFences = (value: string) =>
  value.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();

// 先頭 `{` 〜末尾 `}` の範囲だけ抜き出す。LLM が JSON 前後に文章を添える場合への耐性
const extractFirstJsonObject = (value: string) => {
  const start = value.indexOf('{');
  const end = value.lastIndexOf('}');

  if (start === -1 || end === -1 || end <= start) {
    return value;
  }

  return value.slice(start, end + 1);
};

/**
 * ### safeJsonParse
 * コードフェンスや前後ノイズ付き文字列も含め、JSON.parse を寛容に試みる。
 * 全候補失敗時は undefined を返し例外を投げない
 */
export const safeJsonParse = <TValue = unknown>(
  value: string,
): TValue | undefined => {
  const candidates = [
    value,
    stripCodeFences(value),
    extractFirstJsonObject(stripCodeFences(value)),
  ];

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as TValue;
    } catch {
      continue;
    }
  }

  return undefined;
};

/**
 * ### toJsonString
 * JSON.stringify を安全に実行する。循環参照等で例外が出たら fallback へ落とす
 */
export const toJsonString = (value: unknown, fallback = '{}') => {
  try {
    return JSON.stringify(value);
  } catch {
    return fallback;
  }
};
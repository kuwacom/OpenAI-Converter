// 文字列中のタグ抽出・削除、パターン出現回数計測等のテキスト操作ヘルパ。
// tooling.ts / upstreamContinuationService.ts から共通利用する

/**
 * ### extractTagContents
 * 正規表現のキャプチャグループ1に一致する全断片を取り出す。
 * 呼び出しのたびに exec 状態が変わることを避けるため source/flags から新規 RegExp を生成する
 */
export const extractTagContents = (content: string, pattern: RegExp) => {
  const results: string[] = [];
  const regex = new RegExp(pattern.source, pattern.flags);
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    results.push(match[1] ?? '');
  }

  return results;
};

/** ### stripTags content から pattern にマッチする箇所を除去し前後空白を詰める */
export const stripTags = (content: string, pattern: RegExp) =>
  content.replace(pattern, '').trim();

/** ### countMatches pattern の非重複出現回数を数える */
export const countMatches = (text: string, pattern: RegExp): number =>
  Array.from(text.matchAll(pattern)).length;
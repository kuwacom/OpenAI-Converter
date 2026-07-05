import { safeJsonParse } from '@/lib/jsonUtils';

type InputContainer = { input?: unknown };

/**
 * ### extractCustomToolInput
 * Custom(Freeform) ツールは上流 wrapper と {"input":"<raw text>"} 形式の JSON 文字列で往復する。
 * apply_patch 等 "*** Begin Patch ..." を持つ素テキストをこのラップから取り出さないと、
 * downstream(Codex 等)の検証が first line 認識できず失敗する。本関数で input 値を素テキストへ戻す。
 *
 * {"input": ...} 形状でない場合は原文を保持し情報落ちを防ぐフォールバック付き。
 */
export const extractCustomToolInput = (rawArguments: string): string => {
  const parsed = safeJsonParse<InputContainer>(rawArguments);
  if (
    parsed &&
    typeof parsed === 'object' &&
    'input' in parsed &&
    typeof parsed.input === 'string'
  ) {
    return parsed.input;
  }
  // 万一 {"input": ...} 形状でない場合は原文を保持して情報落ちを防ぐ
  return rawArguments;
};

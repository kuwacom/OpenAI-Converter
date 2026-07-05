/**
 * ### asObject
 * 値が plain object(非配列/非null) なら Record<string,unknown> へ窄めて返す。
 * そうでなければ undefined。引数検証の反復 boilerplate を省くための helper
 */
export const asObject = (
  value: unknown,
): Record<string, unknown> | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
};

/** Record 形状かどうかの型ガード */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
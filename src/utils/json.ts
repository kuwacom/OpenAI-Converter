const stripCodeFences = (value: string) =>
  value
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();

const extractFirstJsonObject = (value: string) => {
  const start = value.indexOf('{');
  const end = value.lastIndexOf('}');

  if (start === -1 || end === -1 || end <= start) {
    return value;
  }

  return value.slice(start, end + 1);
};

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

export const toJsonString = (value: unknown, fallback = '{}') => {
  try {
    return JSON.stringify(value);
  } catch {
    return fallback;
  }
};

export const asObject = (
  value: unknown,
): Record<string, unknown> | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
};

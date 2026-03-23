export type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = {
  [key: string]: JsonValue;
};

export type Dictionary<TValue = unknown> = Record<string, TValue>;

export type MaybePromise<TValue> = Promise<TValue> | TValue;

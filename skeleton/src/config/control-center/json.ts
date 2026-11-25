// JSON helpers for the Control Center contract. The parser is strict: UTF-8 without BOM, JSON objects only.

export type JsonObject = Record<string, unknown>;

export const has = (object: object, key: string): boolean => Object.prototype.hasOwnProperty.call(object, key);

export const isPlainObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const hasOnlyKeys = (object: object, keys: readonly string[]): boolean =>
  Object.keys(object).every((key) => keys.includes(key));


const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

export function parseJsonObject(bytes: Uint8Array): JsonObject | null {
  let text: string;
  try {
    text = utf8.decode(bytes);
  } catch {
    return null;
  }
  if (text.charCodeAt(0) === 0xfeff) return null;
  try {
    const value: unknown = JSON.parse(text);
    return isPlainObject(value) ? value : null;
  } catch {
    return null;
  }
}

export const isPlainObject = (v: unknown): v is Record<string, unknown> => {
  if (typeof v !== 'object' || v === null) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

export const mapValues = (
  o: Record<string, unknown>,
  fn: (value: unknown, key: string) => unknown,
): Record<string, unknown> => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, fn(v, k)]));

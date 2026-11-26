import { createHash } from 'node:crypto';

/** JSON with every object's keys sorted, so the same data hashes the same whatever order it was built in. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return v;
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) sorted[k] = (v as Record<string, unknown>)[k];
    return sorted;
  });
}

export const contentHash = (data: unknown): string => createHash('sha256').update(canonicalJson(data)).digest('hex');

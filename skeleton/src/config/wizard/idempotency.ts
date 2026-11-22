// Idempotency at the adapter. The key covers (op, scope, targetId, idem)
// and an entry remembers the hash of the body, so a key cannot be reused for another request.
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

interface Entry<T> { req: string; expiresAt: number; settled: boolean; promise: Promise<T> }

export type IdempotentRun<T> = { conflict: true } | { conflict: false; replayed: boolean; result: T };

export class IdempotencyCache<T> {
  private entries = new Map<string, Entry<T>>();

  /** `keep` picks the finished results to remember; anything else is forgotten, so a retry runs again. */
  constructor(private readonly opts: { ttlMs?: number; now?: () => number; keep?: (result: T) => boolean } = {}) {}

  async run(keyParts: (string | null)[], req: string, execute: () => Promise<T>): Promise<IdempotentRun<T>> {
    this.prune();
    const key = JSON.stringify(keyParts);
    const existing = this.entries.get(key);
    if (existing) {
      if (existing.req !== req) return { conflict: true };
      return { conflict: false, replayed: true, result: await existing.promise };
    }
    // reserved before execute starts, so a concurrent duplicate waits on the same promise
    const entry: Entry<T> = {
      req, expiresAt: this.now() + (this.opts.ttlMs ?? DEFAULT_TTL_MS), settled: false, promise: Promise.resolve().then(execute),
    };
    this.entries.set(key, entry);
    const forget = () => { if (this.entries.get(key) === entry) this.entries.delete(key); };
    entry.promise.then((result) => {
      entry.settled = true;
      if (this.opts.keep && !this.opts.keep(result)) forget();
    }, forget);
    return { conflict: false, replayed: false, result: await entry.promise };
  }

  get size(): number {
    return this.entries.size;
  }

  private now(): number {
    return (this.opts.now ?? Date.now)();
  }

  private prune(): void {
    const now = this.now();
    for (const [key, entry] of this.entries) {
      if (entry.settled && entry.expiresAt <= now) this.entries.delete(key);
    }
  }
}

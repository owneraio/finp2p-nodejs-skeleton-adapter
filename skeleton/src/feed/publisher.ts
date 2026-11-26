import { contentHash } from './hash';
import { FeedIngest, IngestRefused, StampedItem, withTimeout } from './ingest';
import { FeedKey, FeedMarkers, feedKeyId } from './markers';
import { DataItem, DataProvider } from './provider';

/**
 * The logger the publisher writes to. Either warning method will do: winston
 * on npm levels has `warn`, on syslog levels (the skeleton's own) `warning`.
 */
export interface FeedLogger {
  info(message: string): void;
  error(message: string): void;
  warn?(message: string): void;
  warning?(message: string): void;
}

export interface FeedPublisherOptions {
  /** How long after a round ends the next one starts. */
  intervalMs: number;
  /** How many items one call to the router carries. */
  batchSize?: number;
  /** How long the router has to answer one batch. */
  ingestTimeoutMs?: number;
  /** How long a provider has to give one page. */
  pageTimeoutMs?: number;
  /** How soon a round is tried again after one that ended early; doubled on each further failure, up to the interval. */
  retryAfterMs?: number;
  /** The clock items are stamped from. */
  now?: () => number;
}

/** One source's part of a round. */
export interface FeedRound {
  source: string;
  listed: number;
  changed: number;
  accepted: number;
  rejected: number;
  /** Why the round ended early, when it did. */
  error?: string;
}

export interface FeedSourceStatus {
  source: string;
  lastRoundAt?: string;
  lastRound?: FeedRound;
  /** Rounds in a row in which this source's round ended early. */
  consecutiveFailures: number;
}

export interface FeedStatus {
  /** The sources it publishes now. */
  sources: FeedSourceStatus[];
  lastRoundAt?: string;
  /** Rounds in a row in which any source's round ended early; drives the backoff. */
  consecutiveFailures: number;
}

const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_INGEST_TIMEOUT_MS = 60_000;
const DEFAULT_PAGE_TIMEOUT_MS = 120_000;
const DEFAULT_RETRY_AFTER_MS = 60_000;
/** From this many failed rounds in a row, a source's failure is logged as an error. */
const FAILURES_BEFORE_ERROR = 3;
const REASONS_LOGGED = 5;

interface Pending { key: FeedKey; hash: string; stamped: StampedItem }

/**
 * Publishes the providers' items to the router on a schedule. It holds no
 * provider until the adapter calls `use()`, so nothing is read from a source
 * before the adapter is configured to reach it.
 *
 * A round sends only items whose data changed since the router last accepted
 * them (by the hash in their marker), each stamped `max(now, marker + 1)`,
 * because the router applies only a strictly newer timestamp. A marker is set
 * only for an accepted item.
 *
 * A round that fails (a provider or the router unreachable, or not answering
 * in time) ends there for that source, is logged and left: nothing is
 * queued, and the next round sends what is still unsent. The next round
 * comes sooner than the interval, and later each time it fails again. A
 * batch the router refuses outright is counted as rejected and the round
 * goes on. It never throws into the adapter.
 */
export class FeedPublisher {
  private providers: DataProvider[] = [];
  private readonly history = new Map<string, Omit<FeedSourceStatus, 'source'>>();
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<FeedRound[]> | undefined;
  private readonly batchSize: number;
  private readonly ingestTimeoutMs: number;
  private readonly pageTimeoutMs: number;
  private readonly retryAfterMs: number;
  private readonly now: () => number;
  private readonly warn: (message: string) => void;
  private consecutiveFailures = 0;
  private lastRoundAt: string | undefined;

  constructor(
    private readonly ingest: FeedIngest,
    private readonly markers: FeedMarkers,
    private readonly logger: FeedLogger,
    private readonly options: FeedPublisherOptions,
  ) {
    this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    this.ingestTimeoutMs = options.ingestTimeoutMs ?? DEFAULT_INGEST_TIMEOUT_MS;
    this.pageTimeoutMs = options.pageTimeoutMs ?? DEFAULT_PAGE_TIMEOUT_MS;
    this.retryAfterMs = options.retryAfterMs ?? DEFAULT_RETRY_AFTER_MS;
    this.now = options.now ?? Date.now;
    const warn = logger.warn ?? logger.warning ?? logger.info;
    this.warn = (message) => warn.call(logger, message);
  }

  status(): FeedStatus {
    return {
      sources: this.providers.map((p) => ({ source: p.source, consecutiveFailures: 0, ...this.history.get(p.source) })),
      ...(this.lastRoundAt ? { lastRoundAt: this.lastRoundAt } : {}),
      consecutiveFailures: this.consecutiveFailures,
    };
  }

  /** How long until the next round: the interval, or sooner after a round that ended early. */
  nextDelayMs(): number {
    if (!this.consecutiveFailures) return this.options.intervalMs;
    return Math.min(this.options.intervalMs, this.retryAfterMs * 2 ** (this.consecutiveFailures - 1));
  }

  /**
   * The providers to publish from now on, replacing the ones before. The
   * first round starts at once; with none, it stops. Throws on two providers
   * with the same source, or one with no source or no data types.
   */
  use(providers: DataProvider[]): void {
    const sources = new Set<string>();
    for (const p of providers) {
      if (!p.source) throw new Error('data feed: a provider has no source');
      if (!p.dataTypes.length) throw new Error(`data feed: provider ${p.source} declares no data types`);
      if (sources.has(p.source)) throw new Error(`data feed: two providers share the source ${p.source}`);
      sources.add(p.source);
    }
    this.providers = [...providers];
    this.clearTimer();
    if (!providers.length) return;
    this.logger.info(`data feed: publishing [${[...sources].join(', ')}] to the router every ${Math.round(this.options.intervalMs / 1000)}s`);
    // After a round under way, which still reads the providers before these.
    void (this.running ?? Promise.resolve()).then(() => this.tick());
  }

  /** Stops the schedule; a round under way ends on its own. */
  stop(): void {
    this.providers = [];
    this.clearTimer();
  }

  /** One round over every provider. A round already under way is the one returned. */
  round(): Promise<FeedRound[]> {
    this.running ??= this.publishAll().finally(() => { this.running = undefined; });
    return this.running;
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private async tick(): Promise<void> {
    await this.round();
    if (!this.providers.length || this.timer) return;
    this.timer = setTimeout(() => { this.timer = undefined; void this.tick(); }, this.nextDelayMs());
    this.timer.unref();
  }

  private async publishAll(): Promise<FeedRound[]> {
    const rounds: FeedRound[] = [];
    for (const provider of [...this.providers]) rounds.push(await this.publish(provider));
    if (rounds.length) {
      this.consecutiveFailures = rounds.some((r) => r.error) ? this.consecutiveFailures + 1 : 0;
      this.lastRoundAt = new Date().toISOString();
    }
    return rounds;
  }

  private async publish(provider: DataProvider): Promise<FeedRound> {
    const { source } = provider;
    const round: FeedRound = { source, listed: 0, changed: 0, accepted: 0, rejected: 0 };
    const declared = new Set(provider.dataTypes);
    const seen = new Set<string>();
    const reasons: string[] = [];
    const duplicates: string[] = [];
    let pending: Pending[] = [];
    const reject = (reason: string) => {
      round.rejected += 1;
      if (reasons.length < REASONS_LOGGED) reasons.push(reason);
    };
    const describe = (k: FeedKey) => `${k.identifierType} ${k.identifierValue} ${k.dataType}`;

    const send = async () => {
      const batch = pending;
      pending = [];
      if (!batch.length) return;
      let results;
      try {
        results = await withTimeout(this.ingest(source, batch.map((b) => b.stamped)), this.ingestTimeoutMs, 'the router');
      } catch (e) {
        if (!(e instanceof IngestRefused) || !e.final) throw e;
        // The same batch would be refused again: count it and go on, so it does not hold the batches after it.
        round.rejected += batch.length;
        if (reasons.length < REASONS_LOGGED) reasons.push(`a batch of ${batch.length} from ${describe(batch[0].key)}: ${e.message}`);
        return;
      }
      const byKey = new Map(results.map((r) => [feedKeyId({ source, identifierType: r.identifier.identifierType, identifierValue: r.identifier.identifierValue, dataType: r.dataType }), r]));
      for (const { key, hash, stamped } of batch) {
        const result = byKey.get(feedKeyId(key));
        if (result?.status === 'accepted') {
          await this.markers.set(key, { hash, timestamp: stamped.timestamp });
          round.accepted += 1;
        } else {
          reject(`${describe(key)}: ${result ? result.reason ?? result.status : 'no result from the router'}`);
        }
      }
    };

    const pages = provider.items()[Symbol.asyncIterator]();
    try {
      for (;;) {
        const next = await withTimeout(pages.next(), this.pageTimeoutMs, `${source}'s list`);
        if (next.done) break;
        const candidates: { key: FeedKey; item: DataItem }[] = [];
        for (const item of next.value) {
          round.listed += 1;
          const { identifierType, identifierValue } = item.identifier;
          const key: FeedKey = { source, identifierType, identifierValue, dataType: item.dataType };
          if (!declared.has(item.dataType)) { reject(`${describe(key)}: data type not declared by ${source}`); continue; }
          const id = feedKeyId(key);
          // The router's results could not tell two entries for one key apart: the first in a round is the one sent.
          if (seen.has(id)) { if (duplicates.length < REASONS_LOGGED) duplicates.push(describe(key)); continue; }
          seen.add(id);
          candidates.push({ key, item });
        }
        const markers = await this.markers.getMany(candidates.map((c) => c.key));
        for (const [i, { key, item }] of candidates.entries()) {
          const marker = markers[i];
          const hash = contentHash(item.data);
          if (marker?.hash === hash) continue;
          round.changed += 1;
          const timestamp = Math.max(this.now(), marker ? marker.timestamp + 1 : 0);
          pending.push({ key, hash, stamped: { item, timestamp } });
          if (pending.length >= this.batchSize) await send();
        }
      }
      await send();
    } catch (e) {
      round.error = e instanceof Error ? e.message : String(e);
      // Lets the listing release what it holds; not waited for, since it may be what hangs.
      void pages.return?.(undefined)?.catch(() => undefined);
    }

    this.record(round);
    this.log(round, reasons, duplicates);
    return round;
  }

  private record(round: FeedRound): void {
    const before = this.history.get(round.source)?.consecutiveFailures ?? 0;
    this.history.set(round.source, { lastRoundAt: new Date().toISOString(), lastRound: round, consecutiveFailures: round.error ? before + 1 : 0 });
  }

  private log(round: FeedRound, reasons: string[], duplicates: string[]): void {
    const summary = `data feed ${round.source}: ${round.listed} listed, ${round.changed} new or changed, ${round.accepted} accepted, ${round.rejected} rejected`;
    if (duplicates.length) this.warn(`data feed ${round.source}: listed more than once in a round, sent once: ${duplicates.join(' | ')}`);
    if (round.error) {
      const failures = this.history.get(round.source)?.consecutiveFailures ?? 1;
      const failed = `${summary}; the round ended early and the rest waits for the next: ${round.error}`;
      if (failures >= FAILURES_BEFORE_ERROR) this.logger.error(`${failed} (${failures} rounds in a row)`);
      else this.warn(failed);
    } else if (round.rejected) this.warn(`${summary}; first rejections: ${reasons.join(' | ')}`);
    else this.logger.info(summary);
  }
}

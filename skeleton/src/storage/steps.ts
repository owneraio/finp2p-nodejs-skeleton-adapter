import { createHash } from 'crypto';
import { Pool } from 'pg';
import { assertValidPostgresIdentifier } from './config';
import {
  ResourceClaims, StepBusyError, StepContext, StepExecutor, StepOperation, StepOptions,
  StepRequestMismatchError,
} from '../models';

const DEFAULT_TAKEOVER_AFTER_MS = 120_000;

/**
 * Turns through acquire before giving up. Each turn does at least one blocking
 * statement, so this is generous; exhausting it raises a *retryable*
 * {@link StepBusyError} rather than spinning, which is the safe end for a
 * framework to fail at.
 */
const ACQUIRE_TURNS = 5;
const ACQUIRE_RETRY_DELAY_MS = 50;

/**
 * Stable identity for a step, handed to the body as {@link StepContext.token}
 * so it can be used as a remote idempotency key.
 *
 * **This derivation is a compatibility commitment.** The WisdomTree plugin
 * sends it to Connect as the `Idempotency-Key` header, and Connect keeps a key
 * for hours, so changing the inputs or the format would make Connect treat the
 * resend of an order already in flight as a new order. Scope is deliberately
 * *not* an input, for the same reason: the plugin host that derives it is not
 * always the one that first sent it.
 *
 * The first 32 hex digits of the digest, formatted as a UUID, because that is
 * the shape Connect accepts.
 */
export const stepToken = (operation: StepOperation, name: string): string => {
  const h = createHash('sha256')
    .update(`${operation.method}\u0000${operation.id}\u0000${name}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
};

/**
 * Canonical bytes for a request. Byte-for-byte identical to the plugin host's
 * in generic-custody-adapter, so the same request hashes the same in both
 * stores; the pinned vectors live in both test suites.
 *
 * - Keys sort by code point, never by locale: a locale's collation depends on
 *   how Node was built (a `--without-intl` or small-icu build collates
 *   differently), so two replicas could disagree on the same request.
 * - An object member that is `null` or `undefined` is dropped. The proxy
 *   replays arguments it stored as JSON, where an omitted optional comes back
 *   as `null`, so absent and null have to mean the same thing here.
 * - An array element keeps its `null`: `[1, null]` is a two-element array and
 *   dropping the hole would make it hash as `[1]`.
 */
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined && v !== null)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
};

/** Hash of the inputs a step was first called with. */
export const requestHash = (request: unknown): string =>
  createHash('sha256').update(canonical(request)).digest('hex');

/** The attempt this caller now owns. */
interface Started {
  attempt: number;
  /** Epoch ms of the step's *first* attempt, which a taken-over row carries. */
  firstStartedAt: number;
}

type StepRow =
  | { state: 'done'; requestHash: string; output: unknown }
  | {
    state: 'running' | 'open'; requestHash: string; attempt: number;
    takeable: boolean; retryAfterMs: number;
  };

const WHERE_STEP = 'scope = $1 AND method = $2 AND operation_id = $3 AND step_name = $4';

const started = (row: { attempt: number; first_started_at: string | Date }): Started => ({
  attempt: row.attempt,
  firstStartedAt: new Date(row.first_started_at).getTime(),
});

/**
 * Postgres-backed {@link StepExecutor}, bound to one scope. Build it with
 * {@link PgStepExecutors.forScope} rather than passing a scope per call: a
 * plugin that could name its own scope could read another plugin's steps.
 */
class PgStepExecutor implements StepExecutor {
  /** Concurrent calls in this process share one run rather than contending
   *  over the claim. Per-process only — `priorAttempt` is the durable half. */
  private readonly running = new Map<string, { requestHash: string; run: Promise<unknown> }>();

  constructor(private readonly pool: Pool, private readonly schema: string, private readonly scope: string) {}

  async stored<T>(operation: StepOperation, name: string): Promise<T | undefined> {
    const { rows } = await this.pool.query(
      `SELECT output FROM ${this.schema}.operation_steps
       WHERE ${WHERE_STEP} AND state = 'done'`,
      this.key(operation, name),
    );
    return rows.length ? (rows[0].output as T) : undefined;
  }

  step<T>(operation: StepOperation, name: string, request: unknown,
    fn: (ctx: StepContext) => Promise<T>, options?: StepOptions): Promise<T> {
    const hash = requestHash(request);
    const id = JSON.stringify(this.key(operation, name));
    // Joining is conditional on the hash, not just on the step's identity: two
    // concurrent calls with *different* inputs must not share one run, or the
    // second receives an outcome answering a different question where a
    // sequential call would get StepRequestMismatchError. A different hash
    // starts its own run, which then meets the stored row and throws.
    const joined = this.running.get(id);
    if (joined?.requestHash === hash) {
      return joined.run as Promise<T>;
    }
    const run = this.execute(operation, name, hash, fn, options?.takeoverAfterMs ?? DEFAULT_TAKEOVER_AFTER_MS)
      .finally(() => { if (this.running.get(id)?.run === run) this.running.delete(id); });
    this.running.set(id, { requestHash: hash, run });
    return run;
  }

  /**
   * Acquire, then run. Acquisition is a loop of single statements, each of
   * which holds only if the row is still as this caller saw it:
   *
   * 1. `start` inserts the step if it has no row at all — attempt 1, ours.
   * 2. otherwise `read` classifies the row under a snapshot of its own.
   * 3. a row that is `done`, mismatched, or still held by a fresh attempt
   *    answers immediately;
   * 4. a takeable row is taken by a compare-and-set on `attempt`, which one
   *    caller wins. A loser goes round again rather than running alongside.
   *
   * The read cannot be folded into the insert. `ON CONFLICT` re-reads the
   * index while a `SELECT` beside it reads the statement's snapshot, taken
   * before any concurrent commit the upsert can see, and the two disagree in
   * both directions — both were observed in CI: no row returned at all, and a
   * `done` row reported busy, discarding an outcome sitting in the table.
   */
  private async execute<T>(operation: StepOperation, name: string, hash: string,
    fn: (ctx: StepContext) => Promise<T>, takeoverAfterMs: number): Promise<T> {
    for (let turn = ACQUIRE_TURNS; turn > 0; turn--) {
      const fresh = await this.start(operation, name, hash);
      if (fresh) {
        return this.attempt(operation, name, fn, { token: stepToken(operation, name) }, fresh.attempt);
      }

      const row = await this.read(operation, name, takeoverAfterMs);
      // Took nothing and found nothing: another caller's insert is mid-commit,
      // so it is neither ours to take nor yet visible. The next statement's
      // snapshot includes it.
      if (!row) continue;

      if (row.requestHash !== hash) {
        throw new StepRequestMismatchError(
          `Step '${name}' of operation ${operation.id} was started with different inputs`);
      }
      if (row.state === 'done') {
        return row.output as T;
      }
      if (!row.takeable) {
        throw new StepBusyError(
          `Step '${name}' of operation ${operation.id} is being run by another process`,
          row.retryAfterMs);
      }

      const taken = await this.takeOver(operation, name, row.attempt);
      if (taken) {
        return this.attempt(operation, name, fn, {
          token: stepToken(operation, name),
          priorAttempt: { startedAt: taken.firstStartedAt },
        }, taken.attempt);
      }
    }
    // Retryable rather than fatal: the caller waits and comes back, which is
    // right for contention and harmless if the row really did vanish.
    throw new StepBusyError(
      `Step '${name}' of operation ${operation.id} is contended; could not read its state`,
      ACQUIRE_RETRY_DELAY_MS);
  }

  /**
   * Run the body once and store what it returned. Whatever stops the attempt
   * short of a stored outcome releases the step, so the next call runs at once
   * with `priorAttempt` rather than waiting out the takeover window.
   */
  private async attempt<T>(operation: StepOperation, name: string,
    fn: (ctx: StepContext) => Promise<T>, ctx: StepContext, attempt: number): Promise<T> {
    try {
      return await this.complete<T>(operation, name, await fn(ctx));
    } catch (e) {
      // Nothing recorded: the effect may or may not have happened.
      await this.release(operation, name, attempt).catch(() => undefined);
      throw e;
    }
  }

  private key(operation: StepOperation, name: string): string[] {
    return [this.scope, operation.method, operation.id, name];
  }

  /** Insert the step if it has no row yet. Returns nothing if one exists. */
  private async start(operation: StepOperation, name: string, hash: string): Promise<Started | undefined> {
    const { rows } = await this.pool.query(
      `INSERT INTO ${this.schema}.operation_steps
         (scope, method, operation_id, step_name, request_hash, state, attempt,
          first_started_at, attempt_started_at)
       VALUES ($1, $2, $3, $4, $5, 'running', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT (scope, method, operation_id, step_name) DO NOTHING
       RETURNING attempt, first_started_at`,
      [...this.key(operation, name), hash],
    );
    return rows.length ? started(rows[0]) : undefined;
  }

  /**
   * Classify the row under a snapshot of its own.
   *
   * `takeable` is computed in the database, never against a process clock, so
   * replicas with skewed clocks agree on whether an attempt is still alive. A
   * `takeoverAfterMs` of 0 makes every running attempt takeable, which is how
   * exclusion is disabled for a read-only body.
   */
  private async read(operation: StepOperation, name: string,
    takeoverAfterMs: number): Promise<StepRow | undefined> {
    const { rows } = await this.pool.query(
      `SELECT state, attempt, request_hash, output,
              state = 'open' OR attempt_started_at
                <= CURRENT_TIMESTAMP - ($5::double precision * INTERVAL '1 millisecond') AS takeable,
              GREATEST(0, $5::double precision - EXTRACT(EPOCH FROM
                (CURRENT_TIMESTAMP - attempt_started_at)) * 1000)::bigint AS retry_after_ms
       FROM ${this.schema}.operation_steps WHERE ${WHERE_STEP}`,
      [...this.key(operation, name), takeoverAfterMs],
    );
    if (!rows.length) return undefined;
    const row = rows[0];
    if (row.state === 'done') {
      return { state: 'done', requestHash: row.request_hash, output: row.output };
    }
    return {
      state: row.state,
      requestHash: row.request_hash,
      attempt: row.attempt,
      takeable: row.takeable,
      retryAfterMs: Number(row.retry_after_ms ?? 0),
    };
  }

  /** Start the next attempt, if the step is still at `seenAttempt` and not done. */
  private async takeOver(operation: StepOperation, name: string, seenAttempt: number): Promise<Started | undefined> {
    const { rows } = await this.pool.query(
      `UPDATE ${this.schema}.operation_steps
       SET state = 'running', attempt = attempt + 1,
           attempt_started_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE ${WHERE_STEP} AND attempt = $5 AND state <> 'done'
       RETURNING attempt, first_started_at`,
      [...this.key(operation, name), seenAttempt],
    );
    return rows.length ? started(rows[0]) : undefined;
  }

  /**
   * First writer wins, on `state` alone rather than on this attempt's number.
   * Whoever records an outcome first keeps it; a later finisher matches no row
   * and returns the winner's outcome instead of overwriting it.
   *
   * Matching on `attempt` as well looks tighter but is wrong: two runners that
   * take the claim from each other — which `takeoverAfterMs: 0` invites, since
   * exclusion is off — would both find their attempt superseded and fail,
   * though one of them produced a perfectly good outcome and nobody completed.
   *
   * The stored row is read back rather than returning the in-memory value, so
   * the first run and every later replay see the same thing: a value that has
   * been through JSON.
   */
  private async complete<T>(operation: StepOperation, name: string, output: T): Promise<T> {
    await this.pool.query(
      `UPDATE ${this.schema}.operation_steps
       SET state = 'done', output = $5::jsonb, updated_at = CURRENT_TIMESTAMP
       WHERE ${WHERE_STEP} AND state <> 'done'`,
      [...this.key(operation, name), JSON.stringify(output ?? null)],
    );
    const { rows } = await this.pool.query(
      `SELECT output FROM ${this.schema}.operation_steps
       WHERE ${WHERE_STEP} AND state = 'done'`,
      this.key(operation, name),
    );
    if (!rows.length) {
      // Only reachable if the row vanished under us.
      throw new StepBusyError(
        `Step '${name}' of operation ${operation.id} disappeared before it completed`);
    }
    return rows[0].output as T;
  }

  /**
   * Free the claim after a throw — but only if we still hold it.
   *
   * Matched on the attempt number, unlike {@link complete}, and for the
   * opposite reason. Completion records an outcome, so the first writer should
   * win whoever they are; a release records nothing, so a superseded attempt
   * marking the step open would hand it to a third runner while the real owner
   * is still mid-flight — two live attempts at an effect the exclusion exists
   * to keep single.
   */
  private async release(operation: StepOperation, name: string, attempt: number): Promise<void> {
    await this.pool.query(
      `UPDATE ${this.schema}.operation_steps
       SET state = 'open', updated_at = CURRENT_TIMESTAMP
       WHERE ${WHERE_STEP} AND attempt = $5 AND state = 'running'`,
      [...this.key(operation, name), attempt],
    );
  }
}

/** Builds scope-bound {@link StepExecutor}s over one pool. */
export class PgStepExecutors {
  private readonly schema: string;

  constructor(private readonly pool: Pool, schemaName: string) {
    assertValidPostgresIdentifier(schemaName);
    this.schema = schemaName;
  }

  /** The host names the scope — never the plugin, which would let it read
   *  another plugin's steps. */
  forScope(scope: string): StepExecutor {
    return new PgStepExecutor(this.pool, this.schema, scope);
  }
}

class PgScopedClaims implements ResourceClaims {
  constructor(private readonly pool: Pool, private readonly schema: string, private readonly scope: string) {}

  async claim(namespace: string, resource: string, operationId: string): Promise<string> {
    await this.pool.query(
      `INSERT INTO ${this.schema}.resource_claims (scope, namespace, resource, operation_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (scope, namespace, resource) DO NOTHING`,
      [this.scope, namespace, resource, operationId],
    );
    const { rows } = await this.pool.query(
      `SELECT operation_id FROM ${this.schema}.resource_claims
       WHERE scope = $1 AND namespace = $2 AND resource = $3`,
      [this.scope, namespace, resource],
    );
    return rows[0].operation_id as string;
  }
}

/** Builds scope-bound {@link ResourceClaims} over one pool, for the same
 *  reason as {@link PgStepExecutors}. */
export class PgResourceClaims {
  private readonly schema: string;

  constructor(private readonly pool: Pool, schemaName: string) {
    assertValidPostgresIdentifier(schemaName);
    this.schema = schemaName;
  }

  forScope(scope: string): ResourceClaims {
    return new PgScopedClaims(this.pool, this.schema, scope);
  }
}

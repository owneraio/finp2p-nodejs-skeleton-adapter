import { createHash } from 'crypto';
import { Pool } from 'pg';
import { assertValidPostgresIdentifier } from './config';
import {
  ResourceClaims, StepBusyError, StepContext, StepExecutor, StepOptions, StepRequestMismatchError,
} from '../models';

const DEFAULT_TAKEOVER_AFTER_MS = 120_000;

/**
 * Stable identity for a step, handed to the body as {@link StepContext.token}
 * so it can be used as a remote idempotency key.
 *
 * This derivation is a compatibility commitment: a remote system keyed on a
 * token must keep seeing the same one across upgrades, so changing the inputs
 * or the hash breaks idempotency for every operation already in flight.
 */
export const stepToken = (scope: string, operationId: string, name: string): string =>
  createHash('sha256').update(`${scope}\u0000${operationId}\u0000${name}`).digest('hex');

const canonical = (v: unknown): string => {
  if (v === null || typeof v !== 'object') {
    return JSON.stringify(v) ?? 'null';
  }
  if (Array.isArray(v)) {
    return `[${v.map(canonical).join(',')}]`;
  }
  const entries = Object.entries(v as Record<string, unknown>)
    .filter(([, value]) => value !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, value]) => `${JSON.stringify(k)}:${canonical(value)}`).join(',')}}`;
};

/**
 * Hash of the inputs a step was first called with. Keys are sorted so that two
 * structurally equal requests fingerprint alike regardless of property order;
 * callers pass the value, not a pre-hashed string, so every call site
 * canonicalizes the same way.
 */
const requestHash = (request: unknown): string =>
  createHash('sha256').update(canonical(request)).digest('hex');

interface ClaimRow {
  state: string;
  attempt: number;
  request_hash: string;
  output: unknown;
  prior_started_at: Date | null;
  retry_after_ms: string | number | null;
  /** Database time, so takeover never compares against a process clock. */
  busy: boolean;
}

/**
 * Postgres-backed {@link StepExecutor}, bound to one scope. Build it with
 * {@link PgStepExecutors.forScope} rather than passing a scope per call: a
 * plugin that could name its own scope could read another plugin's steps.
 */
class PgStepExecutor implements StepExecutor {
  /** Concurrent calls in this process share one run rather than contending
   *  over the claim. Per-process only — `priorAttempt` is the durable half. */
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(private readonly pool: Pool, private readonly schema: string, private readonly scope: string) {}

  async stored<T>(operationId: string, name: string): Promise<T | undefined> {
    const { rows } = await this.pool.query(
      `SELECT output FROM ${this.schema}.operation_steps
       WHERE scope = $1 AND operation_id = $2 AND step_name = $3 AND state = 'completed'`,
      [this.scope, operationId, name],
    );
    return rows.length ? (rows[0].output as T) : undefined;
  }

  async step<T>(operationId: string, name: string, request: unknown,
    fn: (ctx: StepContext) => Promise<T>, options?: StepOptions): Promise<T> {
    const key = `${operationId}\u0000${name}`;
    const running = this.inFlight.get(key);
    if (running) {
      return running as Promise<T>;
    }
    const run = this.runStep(operationId, name, request, fn, options)
      .finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, run);
    return run;
  }

  private async runStep<T>(operationId: string, name: string, request: unknown,
    fn: (ctx: StepContext) => Promise<T>, options?: StepOptions): Promise<T> {
    const takeoverAfterMs = options?.takeoverAfterMs ?? DEFAULT_TAKEOVER_AFTER_MS;
    const hash = requestHash(request);
    const claim = await this.acquire(operationId, name, hash, takeoverAfterMs);

    if (claim.request_hash !== hash) {
      throw new StepRequestMismatchError(
        `Step '${name}' of operation ${operationId} was started with different inputs`);
    }
    if (claim.state === 'completed') {
      return claim.output as T;
    }
    if (claim.busy) {
      throw new StepBusyError(
        `Step '${name}' of operation ${operationId} is being run by another process`,
        Number(claim.retry_after_ms ?? 0));
    }

    const ctx: StepContext = {
      token: stepToken(this.scope, operationId, name),
      ...(claim.prior_started_at ? { priorAttempt: { startedAt: claim.prior_started_at } } : {}),
    };

    let output: T;
    try {
      output = await fn(ctx);
    } catch (e) {
      // Nothing recorded: the effect may or may not have happened. Release the
      // claim so the next caller runs immediately, but keep first_started_at so
      // it is told an attempt came before (a crash, by contrast, leaves the
      // claim held until takeoverAfterMs elapses).
      await this.release(operationId, name);
      throw e;
    }
    return this.complete(operationId, name, output);
  }

  /**
   * Take the step, in one statement so concurrent callers cannot both win.
   *
   * `ON CONFLICT DO UPDATE` with a WHERE guard: the row is taken only when no
   * attempt is in flight (`attempt_started_at IS NULL`) or the one in flight is
   * older than the takeover window. Otherwise the update matches nothing and
   * the existing row comes back via the second select, which is how a completed
   * step and a busy step are told apart.
   */
  private async acquire(operationId: string, name: string, hash: string,
    takeoverAfterMs: number): Promise<ClaimRow> {
    const { rows } = await this.pool.query(
      `WITH taken AS (
         INSERT INTO ${this.schema}.operation_steps
           (scope, operation_id, step_name, request_hash, state, attempt, attempt_started_at)
         VALUES ($1, $2, $3, $4, 'running', 1, CURRENT_TIMESTAMP)
         ON CONFLICT (scope, operation_id, step_name) DO UPDATE
           SET attempt = ${this.schema}.operation_steps.attempt + 1,
               attempt_started_at = CURRENT_TIMESTAMP
         WHERE ${this.schema}.operation_steps.state = 'running'
           AND (${this.schema}.operation_steps.attempt_started_at IS NULL
                OR $5::bigint = 0
                OR ${this.schema}.operation_steps.attempt_started_at
                     < CURRENT_TIMESTAMP - ($5::bigint * INTERVAL '1 millisecond'))
         RETURNING state, attempt, request_hash, output, FALSE AS busy,
                   NULL::timestamptz AS prior_started_at, 0::bigint AS retry_after_ms
       )
       SELECT * FROM taken
       UNION ALL
       SELECT state, attempt, request_hash, output,
              state = 'running' AS busy, attempt_started_at AS prior_started_at,
              GREATEST(0, $5::bigint - (EXTRACT(EPOCH FROM
                (CURRENT_TIMESTAMP - attempt_started_at)) * 1000))::bigint AS retry_after_ms
       FROM ${this.schema}.operation_steps
       WHERE scope = $1 AND operation_id = $2 AND step_name = $3
         AND NOT EXISTS (SELECT 1 FROM taken)
       LIMIT 1`,
      [this.scope, operationId, name, hash, String(takeoverAfterMs)],
    );
    const row = rows[0] as ClaimRow;
    // A row taken over keeps whatever first_started_at it had; report the
    // previous attempt's start so the body knows to reconcile.
    if (!row.busy && row.attempt > 1 && !row.prior_started_at) {
      const prior = await this.pool.query(
        `SELECT first_started_at FROM ${this.schema}.operation_steps
         WHERE scope = $1 AND operation_id = $2 AND step_name = $3`,
        [this.scope, operationId, name],
      );
      row.prior_started_at = prior.rows[0]?.first_started_at ?? null;
    }
    return row;
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
   */
  private async complete<T>(operationId: string, name: string, output: T): Promise<T> {
    const { rows } = await this.pool.query(
      `UPDATE ${this.schema}.operation_steps
       SET state = 'completed', output = $4, completed_at = CURRENT_TIMESTAMP, attempt_started_at = NULL
       WHERE scope = $1 AND operation_id = $2 AND step_name = $3 AND state = 'running'
       RETURNING output`,
      [this.scope, operationId, name, JSON.stringify(output ?? null)],
    );
    if (rows.length) {
      return output;
    }
    const winner = await this.stored<T>(operationId, name);
    if (winner === undefined) {
      // Only reachable if the row vanished under us.
      throw new StepBusyError(
        `Step '${name}' of operation ${operationId} disappeared before it completed`);
    }
    return winner;
  }

  private async release(operationId: string, name: string): Promise<void> {
    await this.pool.query(
      `UPDATE ${this.schema}.operation_steps SET attempt_started_at = NULL
       WHERE scope = $1 AND operation_id = $2 AND step_name = $3 AND state = 'running'`,
      [this.scope, operationId, name],
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

export class PgResourceClaims implements ResourceClaims {
  private readonly schema: string;

  constructor(private readonly pool: Pool, schemaName: string) {
    assertValidPostgresIdentifier(schemaName);
    this.schema = schemaName;
  }

  async claim(namespace: string, resource: string, operationId: string): Promise<string> {
    const { rows } = await this.pool.query(
      `INSERT INTO ${this.schema}.resource_claims (namespace, resource, operation_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (namespace, resource) DO UPDATE
         SET operation_id = ${this.schema}.resource_claims.operation_id
       RETURNING operation_id`,
      [namespace, resource, operationId],
    );
    return rows[0].operation_id as string;
  }
}

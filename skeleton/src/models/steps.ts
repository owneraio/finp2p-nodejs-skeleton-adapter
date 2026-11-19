/**
 * Durable sub-steps within one operation.
 *
 * `createServiceProxy` replays an unfinished operation from the top of the
 * method, which is safe only while every effect is idempotent. A step records
 * its outcome, so a replay skips the work already done and resumes at the first
 * step that never completed — a hold placed, an order submitted, a transaction
 * broadcast.
 *
 * Values pass forward through the stored outcome: `place-order` returns the
 * order reference, and on the next run `await-settlement` reads it back.
 *
 * **Outcomes are stored as JSON.** `undefined`, `Date`, `BigInt`, `Map`, class
 * instances and non-enumerable properties do not survive — a `Date` comes back
 * a string. Return plain JSON-safe values. The outcome is read back from the
 * store before it is returned, so the run that produced it sees exactly what a
 * later replay will see rather than its own in-memory value.
 */

/** Which operation a step belongs to. The method is part of a step's identity
 *  because `id` is typically the caller's idempotency key, which carries no
 *  method — so `issue` and `redeem` can arrive under one key. */
export interface StepOperation {
  readonly id: string;
  readonly method: string;
}

/** Passed to the step body. */
export interface StepContext {
  /**
   * Stable per (method, operation id, name) and identical on every attempt,
   * including after a restart — suitable as an idempotency key for a remote
   * API, which is the only thing that closes the window between an effect and
   * its outcome being recorded. A UUID, because that is the shape the remote
   * APIs this was built for accept.
   *
   * Derived from the step's name, so **renaming a step changes the token** and
   * a remote system keying on it treats the retry as a new request. The
   * derivation is a compatibility commitment: see `stepToken`.
   */
  readonly token: string;

  /**
   * Set when an earlier attempt started and never recorded an outcome — the
   * process died mid-step, or the body threw. The effect may or may not have
   * happened, so a body with a non-idempotent effect should reconcile (look the
   * effect up remotely and adopt it) rather than repeat it blindly.
   */
  readonly priorAttempt?: {
    /** Epoch ms, as the database measured it, of the step's *first* attempt —
     *  the window a reconciling body has to search. */
    readonly startedAt: number;
  };
}

export interface StepOptions {
  /**
   * How long another process's in-flight attempt is left alone before this one
   * takes it over. Default 2 minutes. `0` disables exclusion entirely, for a
   * body whose effects are read-only (polling) where concurrent runs are
   * harmless.
   *
   * Measured against database time, never the process clock, so replicas with
   * skewed clocks agree.
   */
  takeoverAfterMs?: number;
}

export interface StepExecutor {
  /**
   * Run `fn` once per (operation, name) and remember what it returned.
   *
   * A completed step returns its stored outcome and `fn` does not run. A body
   * that **returns** completes the step — including one returning a failure
   * value, which is a final outcome and must not be retried. A body that
   * **throws** records nothing and leaves the step open, so the next call runs
   * it again with `priorAttempt` set.
   *
   * `request` fingerprints the inputs this step was first called with. A later
   * call under the same name with different inputs throws
   * {@link StepRequestMismatchError} rather than returning an outcome that
   * answers a different question.
   *
   * Throws {@link StepBusyError} while another process holds the step and its
   * attempt is younger than `takeoverAfterMs`.
   */
  step<T>(operation: StepOperation, name: string, request: unknown,
    fn: (ctx: StepContext) => Promise<T>, options?: StepOptions): Promise<T>;

  /** The stored outcome, or undefined if the step never completed. */
  stored<T>(operation: StepOperation, name: string): Promise<T | undefined>;
}

/**
 * Exclusive ownership of a resource across operations, for a uniqueness a step
 * cannot express because it spans executions — one ledger burn settling exactly
 * one redemption, say.
 *
 * Separate from {@link StepExecutor} deliberately: a claim outlives the
 * operation that took it, carries no outcome and is never replayed.
 */
export interface ResourceClaims {
  /**
   * Claim `resource` for `operationId`, or return the operation that already
   * holds it. The caller compares: equal means the claim is ours.
   */
  claim(namespace: string, resource: string, operationId: string): Promise<string>;
}

/** Another process holds the step and its attempt is still fresh. Retryable. */
export class StepBusyError extends Error {
  readonly code = 'STEP_BUSY';

  /**
   * How long until the holder's claim goes stale and may be taken over, as the
   * database measures it. A restart is the common case: the holder is a dead
   * process and its claim simply has to age out, so the caller waits this long
   * rather than treating the step as failed.
   */
  readonly retryAfterMs: number;

  constructor(message: string, retryAfterMs = 0) {
    super(message);
    this.name = 'StepBusyError';
    this.retryAfterMs = retryAfterMs;
  }
}

/** The step exists under different inputs than the ones now supplied. */
export class StepRequestMismatchError extends Error {
  readonly code = 'STEP_REQUEST_MISMATCH';

  constructor(message: string) {
    super(message);
    this.name = 'StepRequestMismatchError';
  }
}

// Matched on `code`, not instanceof: a consumer may hold its own copy of this
// package, where instanceof across realms is false.
export const isStepBusy = (e: unknown): e is StepBusyError =>
  !!e && (e as { code?: string }).code === 'STEP_BUSY';

export const isStepRequestMismatch = (e: unknown): e is StepRequestMismatchError =>
  !!e && (e as { code?: string }).code === 'STEP_REQUEST_MISMATCH';

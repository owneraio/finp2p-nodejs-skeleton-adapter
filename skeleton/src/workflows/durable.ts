import { logger as defaultLogger } from '../helpers';
import {
  StepBusyError, StepExecutor, StepOptions, isStepBusy, isStepRequestMismatch,
} from '../models';

/**
 * Durable flows: a method written as named blocks that each run at most once.
 *
 * `createServiceProxy` replays an unfinished operation from the top of the
 * method. {@link StepExecutor} already makes a single effect survive that, but
 * a method with several effects has to hand-wire one `step()` call per effect,
 * a try/catch around each, and a mapping from `STEP_BUSY` and
 * `STEP_REQUEST_MISMATCH` to results. `durable` declares the blocks once and
 * does all of that in one place.
 *
 * ```ts
 * const issue = durable<IssueInput, TokenOperationResult>('issue', (op) => {
 *   const order = op.block('resolve-order', { takeoverAfterMs: 0 },
 *     ({ input, refuse }) => resolveOrder(input) ?? refuse('no such asset'));
 *   const placed = op.block('place-order',
 *     ({ get, token, priorAttempt }) => priorAttempt
 *       ? findOrder(get(order))
 *       : connect.createOrder(get(order), token));
 *   return op.block('await-settlement', { takeoverAfterMs: 0 },
 *     ({ get }) => awaitSettlement(get(placed)));
 * });
 *
 * const outcome = await issue.run(steps, { id: operationId, request, input });
 * ```
 *
 * **The declaration runs once**, when `durable` is called — not per execution.
 * `op.block` returns a {@link Handle} rather than a value, and a later block
 * redeems it with `get`. So the flow is a fixed list of blocks in a fixed
 * order, which is what makes a resume comprehensible: every run walks the same
 * blocks and stops at the first one that has not completed. A block cannot be
 * declared conditionally; a flow that needs to skip work should have the block
 * return a sentinel, so that the decision is itself recorded.
 *
 * **A block's name is its identity, permanently.** The name is the step name,
 * so it feeds `ctx.token` — the remote idempotency key. Renaming a block
 * changes the token and a remote system keying on it treats the retry as a new
 * request, which for an order already in flight means placing it twice. Names
 * are as permanent as column names. Nothing here derives a name from a
 * function name, a variable name or a position, deliberately: a refactor must
 * not be able to change a token.
 */

/** Minimal logger shape, so a caller can pass their own. */
export interface FlowLogger {
  info(message: string, ...meta: unknown[]): void;
}

/**
 * A reference to a block's output, redeemed by a later block with `get`.
 *
 * Carries no value of its own: the declaration runs before anything executes,
 * so at declaration time there is nothing to carry.
 */
export interface Handle<T> {
  readonly block: number;
  /** Phantom, never read — it keeps `Handle<A>` from being a `Handle<B>`. */
  readonly produces?: T;
}

/** What a block body is given. */
export interface BlockContext<TInput, TResult> {
  /** The flow's input, the same on every attempt and after a restart. */
  readonly input: TInput;

  /**
   * This block's idempotency token, stable across attempts and restarts. Pass
   * it to a remote API that accepts one: it is the only thing that closes the
   * window between an effect happening and its outcome being recorded.
   */
  readonly token: string;

  /**
   * Set when an earlier attempt at *this* block started and never recorded an
   * outcome. The effect may or may not have happened, so a body with a
   * non-idempotent effect should reconcile — look the effect up remotely and
   * adopt it — rather than repeat it. `startedAt` is epoch ms of the block's
   * first attempt, which is the window worth searching.
   */
  readonly priorAttempt?: { readonly startedAt: number };

  /** A label for logs, defaulting to `<method> <operation id>`. */
  readonly tag: string;

  readonly logger: FlowLogger;

  /** The output of an earlier block. Throws if the block has not run. */
  get<T>(handle: Handle<T>): T;

  /**
   * End the flow here with `result`, and **record that decision**. The result
   * is stored as this block's outcome, so every later replay ends here too
   * without re-running anything. For a final answer that is not an error: a
   * refusal from the venue, a 409 saying the order exists under other terms.
   */
  stop(result: TResult): never;

  /**
   * End *this call* with a failure and record nothing, so a retry runs the
   * block again.
   *
   * **Only safe in a block that has had no effect yet.** Nothing is stored, so
   * the retry repeats whatever the body already did — which for a block that
   * has placed an order means placing it twice. Use it where the body is a
   * lookup and the refusal is a condition that an operator can fix, such as a
   * missing asset: then fixing the configuration makes the retry succeed.
   * Anywhere else, use {@link stop}.
   */
  refuse(reason: string): never;
}

export type BlockBody<TInput, TResult, T> =
  (ctx: BlockContext<TInput, TResult>) => Promise<T> | T;

export interface FlowBuilder<TInput, TResult> {
  block<T>(name: string, body: BlockBody<TInput, TResult, T>): Handle<T>;
  block<T>(name: string, options: StepOptions, body: BlockBody<TInput, TResult, T>): Handle<T>;
}

/** What `run` reports. Every outcome names the block it came from. */
export type FlowOutcome<TResult> =
  | { status: 'completed'; value: TResult; stoppedAt?: string }
  | { status: 'refused'; block: string; reason: string }
  | { status: 'busy'; block: string; retryAfterMs: number; reason: string }
  | { status: 'mismatch'; block: string; reason: string };

export interface FlowRun<TInput> {
  /** The operation id — normally the caller's idempotency key. */
  id: string;

  /**
   * What makes this the request it is, hashed to tell a replay from a reused
   * id. Passed explicitly rather than defaulting to `input`, because the two
   * are not interchangeable: an existing deployment hashes a particular shape,
   * and changing it would make every stored block report a mismatch.
   */
  request: unknown;

  input: TInput;
  tag?: string;
  logger?: FlowLogger;
}

/** Ends the flow, recording the result. */
class StopSignal extends Error {
  constructor(readonly result: unknown) {
    super('flow stopped');
    this.name = 'StopSignal';
  }
}

/** Ends this call without recording anything. */
class RefuseSignal extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'RefuseSignal';
  }
}

/**
 * A block's output is wrapped so that a `stop` survives a restart: without the
 * wrapper there is no way to tell a stored result that ended the flow from one
 * that fed the next block.
 */
interface Wrapped<T> {
  __durableBlock: 'value' | 'stop';
  value: T;
}

const wrap = <T>(kind: 'value' | 'stop', value: T): Wrapped<T> =>
  ({ __durableBlock: kind, value });

/**
 * A row written by a direct `step()` call, before this flow runner existed,
 * holds the value itself rather than a wrapper. Reading it as a plain value
 * keeps adoption free of a data migration.
 */
const unwrap = (stored: unknown): { stop: boolean; value: unknown } => {
  if (stored !== null && typeof stored === 'object' && '__durableBlock' in stored) {
    const w = stored as Wrapped<unknown>;
    return { stop: w.__durableBlock === 'stop', value: w.value };
  }
  return { stop: false, value: stored };
};

interface Block<TInput, TResult> {
  name: string;
  options?: StepOptions;
  body: BlockBody<TInput, TResult, unknown>;
}

export class DurableFlow<TInput, TResult> {
  constructor(
    readonly method: string,
    private readonly blocks: Block<TInput, TResult>[],
    private readonly resultIndex: number,
  ) {}

  /** The block names, in order — the flow's durable identity. */
  get blockNames(): string[] {
    return this.blocks.map((b) => b.name);
  }

  /**
   * Walk the blocks in order. A block that already completed returns its
   * stored outcome without running; the first one that has not runs, with
   * `priorAttempt` set if an earlier attempt was taken over. Calling `run`
   * again *is* the resume — there is no separate resume path.
   */
  async run(steps: StepExecutor, run: FlowRun<TInput>): Promise<FlowOutcome<TResult>> {
    const operation = { id: run.id, method: this.method };
    const tag = run.tag ?? `${this.method} ${run.id}`;
    const log = run.logger ?? (defaultLogger as unknown as FlowLogger);
    const values: unknown[] = new Array(this.blocks.length);
    let skipped = 0;

    for (let index = 0; index < this.blocks.length; index++) {
      const block = this.blocks[index];
      // Captured per iteration: whether anything before this block was already
      // done, which is what makes running it a resume rather than a first run.
      const resuming = skipped > 0;
      let ran = false;
      let stored: unknown;

      try {
        stored = await steps.step(operation, block.name, run.request, async (ctx) => {
          ran = true;
          if (resuming) {
            log.info(`${tag}: resuming at ${block.name}`);
          }
          const blockCtx: BlockContext<TInput, TResult> = {
            input: run.input,
            token: ctx.token,
            ...(ctx.priorAttempt ? { priorAttempt: ctx.priorAttempt } : {}),
            tag,
            logger: log,
            get: <T>(handle: Handle<T>): T => {
              if (handle.block >= index) {
                throw new Error(
                  `${tag}: block '${block.name}' reads a block that has not run yet`);
              }
              return values[handle.block] as T;
            },
            stop: (result: TResult): never => { throw new StopSignal(result); },
            refuse: (reason: string): never => { throw new RefuseSignal(reason); },
          };
          try {
            return wrap('value', await block.body(blockCtx));
          } catch (e) {
            // A stop is an outcome, so it is stored and the flow ends here on
            // every replay. A refusal is not: it leaves the block open.
            if (e instanceof StopSignal) return wrap('stop', e.result);
            throw e;
          }
        }, block.options);
      } catch (e) {
        if (e instanceof RefuseSignal) {
          return { status: 'refused', block: block.name, reason: e.reason };
        }
        if (isStepBusy(e)) {
          return {
            status: 'busy',
            block: block.name,
            retryAfterMs: (e as StepBusyError).retryAfterMs,
            reason: (e as Error).message,
          };
        }
        if (isStepRequestMismatch(e)) {
          return { status: 'mismatch', block: block.name, reason: (e as Error).message };
        }
        throw e;
      }

      if (!ran) skipped++;
      const { stop, value } = unwrap(stored);
      values[index] = value;
      if (stop) {
        return { status: 'completed', value: value as TResult, stoppedAt: block.name };
      }
    }

    return { status: 'completed', value: values[this.resultIndex] as TResult };
  }
}

/**
 * Declare a durable flow. `declare` runs immediately, once, and must return the
 * handle whose output is the flow's result.
 *
 * `method` is the service method the flow implements. It is part of a step's
 * identity and of the token, so it must match the method the operation is
 * stored under.
 */
export function durable<TInput, TResult>(
  method: string,
  declare: (op: FlowBuilder<TInput, TResult>) => Handle<TResult>,
): DurableFlow<TInput, TResult> {
  const blocks: Block<TInput, TResult>[] = [];

  const builder: FlowBuilder<TInput, TResult> = {
    block<T>(
      name: string,
      optionsOrBody: StepOptions | BlockBody<TInput, TResult, T>,
      maybeBody?: BlockBody<TInput, TResult, T>,
    ): Handle<T> {
      const options = typeof optionsOrBody === 'function' ? undefined : optionsOrBody;
      const body = typeof optionsOrBody === 'function' ? optionsOrBody : maybeBody;
      if (!body) {
        throw new Error(`durable flow '${method}': block '${name}' has no body`);
      }
      if (!name) {
        throw new Error(`durable flow '${method}': a block must be named`);
      }
      if (blocks.some((b) => b.name === name)) {
        // Two blocks under one name would be one step: the second would read
        // the first's outcome instead of running.
        throw new Error(`durable flow '${method}': duplicate block name '${name}'`);
      }
      const index = blocks.length;
      blocks.push({ name, options, body: body as BlockBody<TInput, TResult, unknown> });
      return { block: index };
    },
  };

  const result = declare(builder);
  if (blocks.length === 0) {
    throw new Error(`durable flow '${method}': declares no blocks`);
  }
  if (!result || typeof result.block !== 'number' || !blocks[result.block]) {
    throw new Error(`durable flow '${method}': must return the handle of one of its blocks`);
  }
  return new DurableFlow(method, blocks, result.block);
}

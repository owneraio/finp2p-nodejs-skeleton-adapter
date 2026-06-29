import { Pool } from 'pg';
import { DEFAULT_SCHEMA_NAME } from '../storage/config';
import { Operation, WorkflowStorage } from './storage';

/**
 * Resumable workflows
 * ===================
 *
 * A thin, opt-in layer on top of {@link createServiceProxy} that lets a single
 * service method checkpoint its progress so a pod restart can continue from the
 * last completed step instead of from scratch.
 *
 * The proxy already owns the operation lifecycle: it persists the operation as
 * `in_progress` *before* the method runs, returns a `pending` response, and on
 * restart replays every `in_progress` operation by re-invoking the method.
 * `resumableWorkflow` plugs into that: it records each intermediate result in
 * the operation's `intermediate_states` column, and on a replay it reads that
 * array and skips the stages that already ran.
 *
 * It does NOT create the operation row, set status, or persist the final
 * output — that stays with the proxy. The only state it manages is
 * `intermediate_states`. Because of that, the original (non-resumable) proxy
 * path keeps working untouched; adopt `resumableWorkflow` one method at a time.
 *
 * Usage (consumer side):
 *
 * ```ts
 * // once, on startup
 * workflows.setGlobalPool(pool);
 *
 * // inside a proxied service method. Take a rest param `...args` and pass it as
 * // `arguments` — don't reference the magic `arguments` object, which TS rejects
 * // inside an async method when the consumer compiles to ES5 (error TS2522).
 * async createAsset(...args): Promise<TokenCreationResponse> {
 *   return workflows.resumableWorkflow<TokenCreationResponse>(
 *     {
 *       arguments: args,                 // the method's own args — used to find the row
 *       start: async () => {
 *         const tx = await erc20.deploy();
 *         return tx.hash;                // string -> checkpoint, don't wait for the tx
 *       },
 *     },
 *     {
 *       then: async (txHash) => {
 *         await provider.waitForTx(txHash);
 *         const tx = await new ERC20(addr).mint(10000);
 *         return JSON.stringify({ addr, txHash: tx.hash }); // string -> checkpoint
 *       },
 *     },
 *     {
 *       then: async (strState) => {
 *         const { addr } = JSON.parse(strState);
 *         return successfulTokenCreationResponse({ ... });  // non-string -> final result
 *       },
 *     },
 *   );
 * }
 * ```
 *
 * Contract: a stage that returns a **string** is a checkpoint (appended to
 * `intermediate_states`, then the next stage runs). A stage that returns
 * **anything else** is the final result `T` and ends the workflow. For now only
 * strings are supported as checkpoints — serialize richer state yourself
 * (e.g. `JSON.stringify`).
 */

let globalPool: Pool | undefined;
let globalSchema: string = DEFAULT_SCHEMA_NAME;

/**
 * Register the pool (and optionally the schema) that {@link resumableWorkflow}
 * uses to read/write `intermediate_states`. Call once on startup, before any
 * resumable method runs. The caller owns the pool lifecycle.
 */
export function setGlobalPool(pool: Pool, schemaName: string = DEFAULT_SCHEMA_NAME): void {
  globalPool = pool;
  globalSchema = schemaName;
}

/** Test/teardown hook — drop the registered pool. */
export function clearGlobalPool(): void {
  globalPool = undefined;
  globalSchema = DEFAULT_SCHEMA_NAME;
}

/** The first stage: takes no prior state, keyed by the method's `arguments`. */
export interface StartStage<T> {
  /**
   * The enclosing method's arguments (pass the `arguments` keyword). Used to
   * locate the operation row the proxy already persisted — must equal the args
   * the proxy stored under `inputs`.
   */
  arguments: ArrayLike<unknown> | readonly unknown[];
  /** Run when no checkpoint exists yet. Return a string to checkpoint, or `T` to finish. */
  start: () => Promise<T | string>;
}

/** A continuation stage: receives the previous checkpoint string. */
export interface ThenStage<T> {
  /** Return a string to checkpoint and continue, or `T` to finish. */
  then: (previousState: string) => Promise<T | string>;
}

function requireGlobalPool(): Pool {
  if (!globalPool) {
    throw new Error(
      'resumableWorkflow: global pool not set. Call workflows.setGlobalPool(pool) on startup before invoking a resumable workflow.',
    );
  }
  return globalPool;
}

/**
 * Run a checkpointed, resumable workflow. See the module doc for the full
 * contract. Resolves to the final `T`; rejects if a stage throws or if a stage
 * produced a checkpoint but no `then` continuation was provided to consume it.
 *
 * Resume semantics: the stages are `[start, ...thenStages]`. With `k` existing
 * checkpoints the first `k` stages are skipped and execution resumes at
 * `stages[k]`, fed `intermediate_states[k - 1]`. So an empty array runs `start`;
 * one checkpoint skips `start` and runs the first `then`; two checkpoints skip
 * `start` and the first `then`; and so on.
 */
export async function resumableWorkflow<T>(
  startStage: StartStage<T>,
  ...thenStages: ThenStage<T>[]
): Promise<T> {
  const storage = new WorkflowStorage(requireGlobalPool(), globalSchema);

  const inputs = Array.from(startStage.arguments);
  const operation: Operation | undefined = await storage.getOperationByInputs(inputs);
  if (!operation) {
    throw new Error(
      'resumableWorkflow: no operation row found for the given `arguments`. ' +
      'A resumable workflow must run inside a service method wrapped by createServiceProxy, ' +
      'which persists the operation before the method body executes.',
    );
  }

  const states: string[] = [...(operation.intermediate_states ?? [])];
  // stages: index 0 = start, index i (>=1) = thenStages[i - 1]. The number of
  // completed stages equals the number of checkpoints, so resume there.
  let stageIndex = states.length;

  for (; ;) {
    let output: T | string;
    if (stageIndex === 0) {
      output = await startStage.start();
    } else {
      const stage = thenStages[stageIndex - 1];
      if (!stage) {
        throw new Error(
          `resumableWorkflow: stage ${stageIndex} produced an intermediate state but only ` +
          `${thenStages.length} \`then\` stage(s) were provided. Add a \`then\` that consumes it, ` +
          'or have the previous stage return the final (non-string) result.',
        );
      }
      output = await stage.then(states[stageIndex - 1]);
    }

    if (typeof output === 'string') {
      await storage.appendIntermediateState(operation.cid, output);
      states.push(output);
      stageIndex++;
      continue;
    }

    return output;
  }
}

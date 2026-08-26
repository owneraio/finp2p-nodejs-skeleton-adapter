import { currentOperation } from './internal';
import { Operation } from './storage';

/**
 * Resumable workflows: opt-in checkpointing on top of `createServiceProxy`.
 * A stage returning a **string** is a checkpoint (persisted to
 * `intermediate_states`); anything else is the final result. On a replay after
 * a restart, completed stages are skipped and the last checkpoint is fed to
 * the next stage. The proxy still owns row creation, status, outputs, replay.
 *
 * Must be called synchronously (before any `await`) inside a proxied method:
 *
 * ```ts
 * async createAsset(...): Promise<TokenCreationResponse> {
 *   return workflows.resumableWorkflow<TokenCreationResponse>(
 *     { start: async () => (await erc20.deploy()).hash },              // string -> checkpoint
 *     { then: async (txHash) => JSON.stringify(await mint(txHash)) },  // string -> checkpoint
 *     { then: async (s) => successfulTokenCreationResponse(...) },     // non-string -> done
 *   );
 * }
 * ```
 */

export interface StartStage<T> {
  start: () => Promise<T | string>;
}

export interface ThenStage<T> {
  then: (previousState: string) => Promise<T | string>;
}

/**
 * Run a checkpointed, resumable workflow (see module doc). Stages are
 * `[start, ...thenStages]`; with `k` existing checkpoints the first `k`
 * stages are skipped and `stages[k]` runs, fed `intermediate_states[k - 1]`.
 */
export async function resumableWorkflow<T>(
  startStage: StartStage<T>,
  ...thenStages: ThenStage<T>[]
): Promise<T> {
  const ctx = currentOperation;
  if (!ctx) {
    throw new Error(
      'resumableWorkflow: no current operation. Call it synchronously (before any await) ' +
      'inside a service method wrapped by createServiceProxy.',
    );
  }

  const { cid, storage } = ctx;
  const operation: Operation | undefined = await storage.getOperationByCid(cid);
  if (!operation) {
    throw new Error(`resumableWorkflow: no operation row found for cid ${cid}.`);
  }

  const states: string[] = [...(operation.intermediate_states ?? [])];
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
      await storage.appendIntermediateState(cid, output);
      states.push(output);
      stageIndex++;
      continue;
    }

    return output;
  }
}

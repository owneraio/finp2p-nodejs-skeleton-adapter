import { rehydrateEip712Definitions } from '../models';
import {
  OperationStatus,
  CommonService,
  pendingPlan,
  pendingAssetCreation,
  pendingDepositOperation,
  pendingReceiptOperation,
  TokenService,
  failedAssetCreation,
  PlanApprovalService,
  rejectedPlan,
  failedReceiptOperation,
  pendingSwapOperation,
  failedSwapOperation,
  EscrowService,
  PaymentService,
  failedDepositOperation,
  NetworkAccountService,
  pendingAccountOperation,
  failedAccountOperation,
  OperationResponseStrategy,
  OperationMetadata,
  AccountChallengeExpiredError,
  AccountErrorCodes,
  AccountInvalidStateError,
  AccountNotFoundError,
  AccountOperation,
  AccountProof,
  AccountProofRefusedError,
  ChallengedAccountOperation,
  IssuedAccountChallenge,
} from '../models';
import { Operation as StorageOperation, WorkflowStorage, generateCid } from './storage';
import { operationStatusToAPI } from '../routes/mapping';
import { FinP2PClient } from '@owneraio/finp2p-client';
import { logger } from '../helpers';

const dbStatus = <
  T extends
  | { type: 'success' | 'pending' | 'failure' | 'challenge' }
  | { type: 'approved' | 'rejected' | 'pending' },
>(
    obj: T,
  ): StorageOperation['status'] => {
  switch (obj.type) {
    case 'success':
    case 'approved':
      return 'succeeded';
    case 'pending':
      return 'in_progress';
    case 'challenge':
      return 'awaiting_proof';
    case 'failure':
    default:
      return 'failed';
  }
};


/**
 * Makes method names compiletime safe by adding `keyof` constraint. Better than using string literals
 */
const compiletimeMethodName = <T>(methodName: keyof T): string => String(methodName);

const createAccountMethod = compiletimeMethodName<NetworkAccountService>('createAccount');
const submitAccountProofMethod = compiletimeMethodName<NetworkAccountService>('submitAccountProof');

const isAccountChallenge = (outputs: any): outputs is ChallengedAccountOperation =>
  outputs?.operation === 'account' && outputs?.type === 'challenge';

/**
 * The router posts a challenge's proof to the cid the challenge came with, and reads the
 * response strategy off it. Both are the proxy's, which the service cannot know.
 */
const stampChallenge = (outputs: OperationStatus, cid: string, opMetadata: OperationMetadata | undefined): OperationStatus =>
  (isAccountChallenge(outputs) ? { ...outputs, correlationId: cid, metadata: opMetadata } : outputs);

/**
 * Depending on the method name it will provide the proper return object. Can return either `pending` or `error` state depending on args
 */
const wrappedResponse = (methodName: string, opMetadata: OperationMetadata | undefined, args: [cid: string] | [cid: string, errorCode: number, errorMessage: string]): OperationStatus => {
  const pendingOrError = <R>(pending: (cid: string) => R, error: (cid: string, errorCode: number, errorMessage: string) => R): R => {
    if (args.length === 1) {
      return pending(...args);
    } else {
      return error(...args);
    }
  };

  switch (methodName) {
    case compiletimeMethodName<TokenService>('createAsset'):
      return pendingOrError(cid => pendingAssetCreation(cid, opMetadata), (cid, code, message) => failedAssetCreation(code, message));
    case compiletimeMethodName<TokenService>('issue'):
    case compiletimeMethodName<TokenService>('transfer'):
    case compiletimeMethodName<TokenService>('redeem'):
    case compiletimeMethodName<EscrowService>('hold'):
    case compiletimeMethodName<EscrowService>('release'):
    case compiletimeMethodName<EscrowService>('rollback'):
    case compiletimeMethodName<PaymentService>('payout'):
      return pendingOrError(cid => pendingReceiptOperation(cid, opMetadata), (cid, code, message) => failedReceiptOperation(code, message));
    case compiletimeMethodName<TokenService>('swap'):
      return pendingOrError(cid => pendingSwapOperation(cid, opMetadata), (cid, code, message) => failedSwapOperation(code, message));
    case compiletimeMethodName<PlanApprovalService>('approvePlan'):
    case compiletimeMethodName<PlanApprovalService>('proposeCancelPlan'):
    case compiletimeMethodName<PlanApprovalService>('proposeResetPlan'):
    case compiletimeMethodName<PlanApprovalService>('proposeInstructionApproval'):
      return pendingOrError(cid => pendingPlan(cid, opMetadata), (cid, code, message) => rejectedPlan(code, message));
    case compiletimeMethodName<PaymentService>('getDepositInstruction'):
      return pendingOrError(cid => pendingDepositOperation(cid, opMetadata), (cid, code, message) => failedDepositOperation(code, message));
    case compiletimeMethodName<NetworkAccountService>('createAccount'):
    case compiletimeMethodName<NetworkAccountService>('removeAccount'):
      return pendingOrError(cid => pendingAccountOperation(cid, opMetadata), (cid, code, message) => failedAccountOperation(cid, code, message));
    default:
      throw new Error(`Unknown proxied method '${methodName}' — add it to wrappedResponse()`);
  }
};

/**
 * Persist result to DB, then send callback to router.
 * Only sends the callback if the DB write succeeds — otherwise the row
 * stays in_progress and will be replayed on restart, which is correct.
 */
/**
 * Extract loggable fields from an error.
 * Plain Error has non-enumerable `message`/`stack` so JSON.stringify produces `{}`.
 * Axios/fetch errors carry extra details (status, response body) we want to surface.
 */
function describeError(err: unknown): Record<string, unknown> {
  if (err === null || err === undefined) return { error: String(err) };
  if (typeof err !== 'object') return { error: String(err) };

  const e = err as any;
  const out: Record<string, unknown> = {};
  if (e.name) out.name = e.name;
  if (e.message) out.message = e.message;
  if (e.code) out.code = e.code;
  if (typeof e.status === 'number') out.status = e.status;
  if (typeof e.statusCode === 'number') out.statusCode = e.statusCode;

  // Axios-style: err.response.{status,statusText,data}
  if (e.response) {
    const r = e.response;
    out.response = {
      status: r.status,
      statusText: r.statusText,
      data: r.data,
    };
  }
  // openapi-fetch style: err.cause might carry Response or body
  if (e.cause) {
    out.cause = describeError(e.cause);
  }
  // Request context (URL, method) if available
  if (e.config) {
    out.request = { url: e.config.url, method: e.config.method };
  }
  if (e.stack) {
    // Keep only the first few frames to avoid log noise
    out.stack = String(e.stack).split('\n').slice(0, 6).join('\n');
  }
  // Fallback: if nothing surfaced, preserve the raw JSON
  if (Object.keys(out).length === 0) {
    try {
      out.raw = JSON.stringify(err);
    } catch {
      out.raw = String(err);
    }
  }
  return out;
}

/** Sends an operation's state to the router on `cid`, when a FinP2PClient is configured (callback strategy). */
async function sendCallback(finP2PClient: FinP2PClient | undefined, cid: string, outputs: OperationStatus,
  status?: StorageOperation['status']): Promise<void> {
  if (!finP2PClient) {
    return;
  }
  const callbackPayload = operationStatusToAPI(outputs);
  logger.debug('Sending callback to router', { cid, status, outputsType: (outputs as any)?.type });
  try {
    const result = await finP2PClient.sendCallback(cid, callbackPayload);
    // openapi-fetch returns { data, error, response } instead of throwing on HTTP errors
    const httpError = (result as any)?.error;
    if (httpError) {
      const response = (result as any)?.response;
      logger.error('Callback rejected by router (HTTP error)', {
        cid,
        status: response?.status,
        statusText: response?.statusText,
        error: httpError,
        payload: callbackPayload,
      });
    }
  } catch (err) {
    logger.error('Failed to send callback to router', {
      cid,
      ...describeError(err),
      payload: callbackPayload,
    });
  }
}

async function finalize(
  storage: WorkflowStorage,
  finP2PClient: FinP2PClient | undefined,
  cid: string,
  status: StorageOperation['status'],
  outputs: OperationStatus,
): Promise<void> {
  try {
    await storage.completeOperation(cid, status, outputs);
  } catch (err) {
    logger.error('Failed to persist operation result — skipping callback so restart can retry', { cid, ...describeError(err) });
    return;
  }
  await sendCallback(finP2PClient, cid, outputs, status);
}

/**
 * Execute a service method and finalize the result (persist + callback).
 * Catches both sync throws and async rejections from the method.
 * Used by both crash recovery and the live proxy path.
 */
async function executeAndFinalize(
  method: Function,
  args: any[],
  methodName: string,
  cid: string,
  opMetadata: OperationMetadata | undefined,
  storage: WorkflowStorage,
  finP2PClient: FinP2PClient | undefined,
): Promise<void> {
  try {
    let outputs: OperationStatus = await method(...args);
    if (isAccountChallenge(outputs)) {
      // Only a createAccount whose service completes challenges may answer with one, and
      // that one runs in runAccountCreate; here nothing could answer its proof, so fail
      // rather than park an onboarding nobody can finish.
      logger.error('Operation issued an account challenge, but the service has no completeAccountChallenge', { method: methodName, cid });
      outputs = failedAccountOperation(cid, 1, `a ${outputs.challenge.type} challenge was issued, but this adapter cannot complete one`);
    }
    await finalize(storage, finP2PClient, cid, dbStatus(outputs), outputs);
  } catch (error: any) {
    logger.error('Operation failed', { method: methodName, cid, ...describeError(error) });
    const wrp = wrappedResponse(methodName, opMetadata, [cid, 1, String(error)]);
    await finalize(storage, finP2PClient, cid, 'failed', wrp);
  }
}

/**
 * JSON.stringify drops the EIP-712 declaration (it hangs off the type map
 * non-enumerably), so an operation replayed after a restart would reach the
 * adapter with the map alone. Rebuild it on the way back in. The stored bytes
 * are untouched, so the `(method, inputs)` dedupe key is unchanged.
 */
const rehydrateInputs = (inputs: any): any => {
  if (Array.isArray(inputs)) {
    return inputs.map(rehydrateInputs);
  }
  if (inputs === null || typeof inputs !== 'object') {
    return inputs;
  }
  if (inputs.type === 'EIP712' && inputs.types && typeof inputs.types === 'object') {
    return { ...inputs, types: rehydrateEip712Definitions(inputs.types, inputs.domain) };
  }
  return Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, rehydrateInputs(v)]));
};

/**
 * Runs createAccount for a service that completes challenges, inside the create request:
 * a polling router never surfaces a challenge that arrives later, so the challenge must
 * ride the create response (207), and a result completes the bind synchronously. A
 * pending result fails the create: the service never learns the proxy's cid, so nothing
 * could finish it later. The outcome is persisted before it is returned, so a create
 * retried with the same Idempotency-Key replays it. Rejects when it cannot be persisted:
 * the row stays in_progress and runs again on such a retry, or on restart.
 */
async function runAccountCreate(method: Function, args: any[], cid: string,
  opMetadata: OperationMetadata | undefined, storage: WorkflowStorage): Promise<OperationStatus> {
  let outputs: OperationStatus;
  try {
    const result: OperationStatus = await method(...args);
    if (result.type === 'pending') {
      throw new Error('createAccount must settle the create or issue a challenge, not answer pending');
    }
    outputs = stampChallenge(result, cid, opMetadata);
  } catch (error: any) {
    logger.error('Operation failed', { method: createAccountMethod, cid, ...describeError(error) });
    outputs = failedAccountOperation(cid, 1, String(error));
  }
  await storage.completeOperation(cid, dbStatus(outputs), outputs);
  return outputs;
}

/** The challenged create as completeAccountChallenge sees it. `inputs` holds createAccount's arguments, in order. */
const issuedChallengeOf = (row: StorageOperation): IssuedAccountChallenge => {
  const [idempotencyKey, organizationId, assetId, finId, bindInfo] = rehydrateInputs(row.inputs);
  const { challenge, expiresAt } = row.outputs as ChallengedAccountOperation;
  return {
    correlationId: row.cid,
    // JSON keeps an absent bindInfo (create-new mode) as null
    request: { idempotencyKey, organizationId, assetId, finId, bindInfo: bindInfo ?? undefined },
    challenge,
    expiresAt,
  };
};

/**
 * Finishes a create this proof claimed: completeAccountChallenge gets the create's request,
 * the challenge it issued and the proof. A throw reopens the challenge and answers the
 * proof with the error: a refusal with its own status, anything else with 500. A returned
 * success or failure settles the row and goes to the router on the create cid, the only
 * place it reads the outcome.
 */
async function settleClaimedChallenge(service: NetworkAccountService, storage: WorkflowStorage,
  finP2PClient: FinP2PClient | undefined, idempotencyKey: string, row: StorageOperation,
  proof: AccountProof): Promise<AccountOperation> {
  const { cid } = row;
  let outcome: AccountOperation;
  try {
    outcome = await service.completeAccountChallenge!(idempotencyKey, issuedChallengeOf(row), proof);
    if (outcome.type === 'pending' || outcome.type === 'challenge') {
      throw new Error(`completeAccountChallenge must settle the create with success or failure, not ${outcome.type}`);
    }
  } catch (error) {
    // When this write fails too, the claim stays until a restart reopens it.
    await storage.transitionOperation(cid, 'in_progress', 'awaiting_proof').catch((reopenError) =>
      logger.error('Failed to reopen account challenge', { cid, ...describeError(reopenError) }));
    if (error instanceof AccountProofRefusedError) {
      throw error;
    }
    // Any other class would answer with its own route status, e.g. a BusinessError as 200,
    // which the router takes for "proof taken" while the challenge is open again.
    logger.error('Failed to complete account challenge; it stays open', { cid, ...describeError(error) });
    throw new Error(`completeAccountChallenge failed for account create ${cid}: ${String(error)}`);
  }
  const status = dbStatus(outcome);
  if (!await storage.transitionOperation(cid, 'in_progress', status, outcome)) {
    // Another instance's restart reopened the claim. The work is idempotent: the next proof redoes it.
    throw new AccountInvalidStateError(`account create ${cid} was reopened while its proof was completed; submit the proof again`);
  }
  await sendCallback(finP2PClient, cid, outcome, status);
  return outcome;
}

/**
 * POST /accounts/{cid}/proof for a proxied createAccount. The router sends a fresh
 * Idempotency-Key on every proof, so a repeat is told apart by the row's state: only the
 * proof that claims the row (awaiting_proof -> in_progress) runs completeAccountChallenge,
 * inside the request, so a refusal reaches the client.
 */
async function acceptProof(service: NetworkAccountService, storage: WorkflowStorage,
  finP2PClient: FinP2PClient | undefined, idempotencyKey: string, cid: string,
  proof: AccountProof): Promise<AccountOperation> {
  // A proof that loses the claim to another reads the row again and answers from there.
  for (let pass = 0; pass < 2; pass++) {
    const row = await storage.getOperationByCid(cid);
    if (!row || row.method !== createAccountMethod) {
      throw new AccountNotFoundError(`no account create with cid ${cid}`, AccountErrorCodes.notFound);
    }
    const op = row.outputs as AccountOperation;
    switch (row.status) {
      case 'succeeded':
      case 'failed':
        if (op.type === 'failure' && op.error.code === AccountErrorCodes.challengeTimeout) {
          throw new AccountChallengeExpiredError(`the challenge of account create ${cid} expired`);
        }
        if (row.status === 'failed') {
          throw new AccountInvalidStateError(`account create ${cid} has failed${op.type === 'failure' ? `: ${op.error.message}` : ''}`);
        }
        return op;
      case 'in_progress':
        if (isAccountChallenge(op)) {
          // Another proof holds the claim and is completing the create.
          return pendingAccountOperation(cid, op.metadata);
        }
        throw new AccountInvalidStateError(`account create ${cid} has not issued a challenge`);
      case 'awaiting_proof': {
        // The deadline is not checked here: completeAccountChallenge gets it and decides.
        const claimed = await storage.transitionOperation(cid, 'awaiting_proof', 'in_progress');
        if (claimed) {
          return settleClaimedChallenge(service, storage, finP2PClient, idempotencyKey, claimed, proof);
        }
        break;
      }
      default:
        break;
    }
  }
  throw new AccountInvalidStateError(`account create ${cid} changed state while its proof was submitted; submit it again`);
}

export function createServiceProxy<T extends object>(
  migrationJob: () => Promise<void>,
  storage: WorkflowStorage,
  finP2PClient: FinP2PClient | undefined,
  service: T,
  ...methodsToProxy: (keyof T)[]
): T {
  const opMetadata: OperationMetadata | undefined = finP2PClient ? { responseStrategy: 'callback' } : undefined;

  // A proxied createAccount whose service completes challenges may answer with one: the
  // create then runs inside its request and POST /accounts/{cid}/proof is answered from the
  // operations rows. Nothing runs on a timer: a challenge's deadline is stored and reported,
  // and completeAccountChallenge enforces it if it wants to.
  const accounts = service as unknown as NetworkAccountService;
  const challenges = methodsToProxy.some((m) => String(m) === createAccountMethod)
    && typeof accounts.completeAccountChallenge === 'function';
  if (challenges && typeof accounts.submitAccountProof === 'function') {
    logger.warning('The workflow proxy answers submitAccountProof through completeAccountChallenge; the service\'s own submitAccountProof is not called');
  }

  // Account creates running in this process, so a create retried with the same
  // Idempotency-Key waits for the run instead of answering pending.
  const runningCreates = new Map<string, Promise<OperationStatus>>();
  const trackCreate = (cid: string, run: Promise<OperationStatus>): Promise<OperationStatus> => {
    runningCreates.set(cid, run);
    const forget = () => { runningCreates.delete(cid); };
    run.then(forget, forget);
    return run;
  };

  // A create retried with the same Idempotency-Key. It joins the run while that is still
  // going here; otherwise it answers the row as it is now (a parked challenge again, with
  // the time it has left), since the insert's snapshot may predate the run's result. A row
  // still waiting for its first result that nothing runs here (its result failed to
  // persist; one writer per schema) runs again.
  const joinCreate = async (method: Function, args: any[], stored: StorageOperation): Promise<OperationStatus> => {
    const { cid } = stored;
    const running = runningCreates.get(cid);
    if (running) {
      return running;
    }
    const row = await storage.getOperationByCid(cid) ?? stored;
    const runningNow = runningCreates.get(cid);
    if (runningNow) {
      return runningNow;
    }
    if (row.status === 'in_progress' && !isAccountChallenge(row.outputs)) {
      return trackCreate(cid, runAccountCreate(method, args, cid, opMetadata, storage));
    }
    return row.outputs;
  };

  // Wait for migrations, then replay pending operations (crash recovery).
  const ready = migrationJob().then(async () => {
    methodsToProxy.forEach((m) => {
      if (challenges && String(m) === createAccountMethod) {
        return; // replayed below, before ready resolves
      }
      const raw = service[m];
      if (typeof raw !== 'function') return;
      const method = raw.bind(service);

      storage.getPendingOperations(String(m)).then(
        (operations) => {
          for (const op of operations) {
            executeAndFinalize(method, rehydrateInputs(op.inputs), op.method, op.cid, opMetadata, storage, finP2PClient);
          }
        },
        (error) => logger.error('Failed to fetch pending operations', { error }),
      );
    });

    if (challenges) {
      // Fetched before ready resolves, so a create retried right after boot finds its replay running.
      const createAccount = accounts.createAccount.bind(service);
      let operations: StorageOperation[] = [];
      try {
        operations = await storage.getPendingOperations(createAccountMethod);
      } catch (error) {
        logger.error('Failed to fetch pending operations', { error });
      }
      for (const op of operations) {
        if (isAccountChallenge(op.outputs)) {
          // A proof was being completed when the process stopped. Its request failed, so
          // the investor sends it again: reopen the challenge before ready resolves, so
          // that proof finds it open rather than claimed.
          await storage.transitionOperation(op.cid, 'in_progress', 'awaiting_proof').catch((error) =>
            logger.error('Failed to reopen account challenge', { cid: op.cid, ...describeError(error) }));
        } else {
          // Nobody waits on a replayed create: its outcome goes out by callback.
          trackCreate(op.cid, runAccountCreate(createAccount, rehydrateInputs(op.inputs), op.cid, opMetadata, storage))
            .then((outputs) => sendCallback(finP2PClient, op.cid, outputs, dbStatus(outputs)))
            .catch((error) => logger.error('Failed to persist account create result; a restart replays it', { cid: op.cid, ...describeError(error) }));
        }
      }
    }
  });

  const getOperationStatusMethod: keyof CommonService = 'operationStatus';

  return new Proxy(service, {
    get(target: T, prop: string | symbol, receiver: any) {
      if (String(prop) === getOperationStatusMethod) {
        return async function (this: any, ...args: any[]) {
          await ready;
          if (args.length !== 1) throw new Error('Expected only 1 argument. Did the interface got changed?');
          const cid = args[0];
          if (typeof cid !== 'string') throw new Error('Expected string argument. Did the interface got changed?');

          const operation = await storage.getOperationByCid(cid);
          if (operation === undefined) throw new Error(`Operation with following cid not found: ${cid}`);

          return operation.outputs;
        };
      }

      if (challenges && String(prop) === submitAccountProofMethod) {
        return async (idempotencyKey: string, cid: string, proof: AccountProof): Promise<AccountOperation> => {
          await ready;
          return acceptProof(target as unknown as NetworkAccountService, storage, finP2PClient, idempotencyKey, cid, proof);
        };
      }

      const originalMethod = target[prop as keyof T];

      if (typeof originalMethod !== 'function') {
        return originalMethod;
      }

      const m = methodsToProxy.find((m) => m === String(prop));
      if (!m) {
        return originalMethod;
      }
      return async function (this: any, ...args: any[]) {
        await ready;

        const correlationId = generateCid();
        const pendingPlaceholder = wrappedResponse(String(prop), opMetadata, [correlationId]);

        const [storageOperation, inserted] = await storage.saveOperation({
          inputs: args, // <- already contains idempotency key
          method: String(prop),
          outputs: pendingPlaceholder,
          cid: correlationId,
          status: 'in_progress',
        });

        if (challenges && String(prop) === createAccountMethod) {
          const createAccount = originalMethod.bind(this === receiver ? target : this);
          if (!inserted) {
            return joinCreate(createAccount, args, storageOperation);
          }
          // Inside the request: the create response is how the challenge reaches the router.
          return trackCreate(correlationId, runAccountCreate(createAccount, args, correlationId, opMetadata, storage));
        }
        if (!inserted) {
          return storageOperation.outputs;
        }

        // Fire-and-forget: execute in background, finalize handles errors
        executeAndFinalize(
          originalMethod.bind(this === receiver ? target : this),
          args, String(prop), correlationId, opMetadata, storage, finP2PClient,
        );

        return pendingPlaceholder;
      };
    },
  });
}

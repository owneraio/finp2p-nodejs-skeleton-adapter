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
  EscrowService,
  PaymentService,
  failedDepositOperation,
  OperationResponseStrategy,
  OperationMetadata,
} from '../models';
import { Operation as StorageOperation, WorkflowStorage, generateCid } from './storage';
import { operationStatusToAPI } from '../routes/mapping';
import { FinP2PClient } from '@owneraio/finp2p-client';
import { logger } from '../helpers';

const dbStatus = <
  T extends
  | { type: 'success' | 'pending' | 'failure' }
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
    case 'failure':
    default:
      return 'failed';
  }
};


/**
 * Makes method names compiletime safe by adding `keyof` constraint. Better than using string literals
 */
const compiletimeMethodName = <T>(methodName: keyof T): string => String(methodName);

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
    case compiletimeMethodName<PlanApprovalService>('approvePlan'):
    case compiletimeMethodName<PlanApprovalService>('proposeCancelPlan'):
    case compiletimeMethodName<PlanApprovalService>('proposeResetPlan'):
    case compiletimeMethodName<PlanApprovalService>('proposeInstructionApproval'):
      return pendingOrError(cid => pendingPlan(cid, opMetadata), (cid, code, message) => rejectedPlan(code, message));
    case compiletimeMethodName<PaymentService>('getDepositInstruction'):
      return pendingOrError(cid => pendingDepositOperation(cid, opMetadata), (cid, code, message) => failedDepositOperation(code, message));
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
  if (finP2PClient) {
    const callbackPayload = operationStatusToAPI(outputs);
    logger.debug('Sending callback to router', { cid, status, outputsType: (outputs as any)?.type });
    try {
      // @ts-ignore — operationStatus type mismatch with sendCallback signature
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
    const outputs: OperationStatus = await method(...args);
    await finalize(storage, finP2PClient, cid, dbStatus(outputs), outputs);
  } catch (error: any) {
    const wrp = wrappedResponse(methodName, opMetadata, [cid, 1, String(error)]);
    await finalize(storage, finP2PClient, cid, 'failed', wrp);
  }
}

export function createServiceProxy<T extends object>(
  migrationJob: () => Promise<void>,
  storage: WorkflowStorage,
  finP2PClient: FinP2PClient | undefined,
  service: T,
  ...methodsToProxy: (keyof T)[]
): T {
  const opMetadata: OperationMetadata | undefined = finP2PClient ? { responseStrategy: 'callback' } : undefined;

  // Wait for migrations only. Crash recovery runs in the background after
  // migration completes and does NOT block the ready gate — incoming requests
  // can proceed as soon as the DB schema is up to date.
  const ready = migrationJob().then(() => {
    logger.debug('Migration complete, scheduling crash recovery', { methods: methodsToProxy.map(String) });
    // Crash recovery: fire-and-forget per method. Does not block ready.
    for (const m of methodsToProxy) {
      const raw = service[m];
      if (typeof raw !== 'function') continue;
      const method = raw.bind(service);

      storage.getPendingOperations(String(m)).then(
        (operations) => {
          if (operations.length > 0) {
            logger.info(`Crash recovery: replaying ${operations.length} pending operation(s) for ${String(m)}`);
          }
          for (const op of operations) {
            executeAndFinalize(method, op.inputs, op.method, op.cid, opMetadata, storage, finP2PClient);
          }
        },
        (error) => logger.error('Failed to fetch pending operations', { method: String(m), error }),
      );
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

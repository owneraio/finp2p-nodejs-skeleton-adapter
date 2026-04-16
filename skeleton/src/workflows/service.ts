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
    logger.error('Failed to persist operation result — skipping callback so restart can retry', { cid, error: err });
    return;
  }
  if (finP2PClient) {
    try {
      // @ts-ignore — operationStatus type mismatch with sendCallback signature
      await finP2PClient.sendCallback(cid, operationStatusToAPI(outputs));
    } catch (err) {
      logger.error('Failed to send callback to router', { cid, error: err });
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

  // Wait for migrations, then replay pending operations (crash recovery).
  const ready = migrationJob().then(() => {
    methodsToProxy.forEach((m) => {
      const raw = service[m];
      if (typeof raw !== 'function') return;
      const method = raw.bind(service);

      storage.getPendingOperations(String(m)).then(
        (operations) => {
          for (const op of operations) {
            executeAndFinalize(method, op.inputs, op.method, op.cid, opMetadata, storage, finP2PClient);
          }
        },
        (error) => logger.error('Failed to fetch pending operations', { error }),
      );
    });
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

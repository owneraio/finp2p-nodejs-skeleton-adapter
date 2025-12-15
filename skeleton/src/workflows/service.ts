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
} from '@owneraio/finp2p-adapter-models';
import { FinP2PClient } from '@owneraio/finp2p-client';
import { Operation as StorageOperation, Storage, generateCid } from './storage';
import { operationStatusToAPI } from '../routes/mapping';

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
const wrappedResponse = (methodName: string, args: [cid: string] | [cid: string, errorCode: number, errorMessage: string]): any => {
  const pendingOrError = <R>(pending: (cid: string) => R, error: (cid: string, errorCode: number, errorMessage: string) => R): R => {
    if (args.length === 1) {
      return pending(...args);
    } else {
      return error(...args);
    }
  };

  switch (methodName) {
    case compiletimeMethodName<TokenService>('createAsset'):
      return pendingOrError(cid => pendingAssetCreation(cid, undefined), (cid, code, message) => failedAssetCreation(code, message));
    case compiletimeMethodName<TokenService>('issue'):
    case compiletimeMethodName<TokenService>('transfer'):
    case compiletimeMethodName<TokenService>('redeem'):
    case compiletimeMethodName<EscrowService>('hold'):
    case compiletimeMethodName<EscrowService>('release'):
    case compiletimeMethodName<EscrowService>('rollback'):
    case compiletimeMethodName<PaymentService>('payout'):
      return pendingOrError(cid => pendingReceiptOperation(cid, undefined), (cid, code, message) => failedReceiptOperation(code, message));
    case compiletimeMethodName<PlanApprovalService>('approvePlan'):
      return pendingOrError(cid => pendingPlan(cid, undefined), (cid, code, message) => rejectedPlan(code, message));
    case compiletimeMethodName<PaymentService>('getDepositInstruction'):
      return pendingOrError(cid => pendingDepositOperation(cid, undefined), (cid, code, message) => failedDepositOperation(code, message));
    default:
      return {
        wrappedArgs: args,
      };
  }
};

const sendCallbackIfNeeded = (finP2PClient: FinP2PClient | undefined, methodName: string, cid: string, status: OperationStatus):  Promise<OperationStatus> => {
  if (finP2PClient === undefined) { return Promise.resolve(status); }

  console.debug(`sending callback for ${cid}, ${methodName}`);
  // @ts-ignore
  return finP2PClient.sendCallback(cid, operationStatusToAPI(status)).then(() => Promise.resolve(status));
};

export function createServiceProxy<T extends object>(
  migrationJob: () => Promise<void>,
  storage: Storage,
  finP2PClient: FinP2PClient | undefined, // TODO: switch to callback oriented when tests are ready
  service: T,
  ...methodsToProxy: (keyof T)[]
): T {
  migrationJob().then(() =>
    methodsToProxy.forEach((m) => {
      const method = service[m];
      if (typeof method !== 'function') return;

      storage.getPendingOperations(String(m)).then(
        (operations) => {
          operations.forEach((op) => {
            method(...op.inputs).then(
              (outputs: OperationStatus) => {
                storage.update(op.cid, dbStatus(outputs), outputs);
                return sendCallbackIfNeeded(finP2PClient, op.method, op.cid, outputs);
              },
              (error: any) => {
                storage.update(op.cid, 'failed', wrappedResponse(op.method, [op.cid, 1, String(error)]));
                return sendCallbackIfNeeded(finP2PClient, op.method, op.cid, error as OperationStatus);
              },
            );
          });
        },
        (error) => console.error(`Couldn'nt fetch pending operations: ${error}`),
      );
    }),
  );

  const getOperationStatusMethod: keyof CommonService = 'operationStatus';

  return new Proxy(service, {
    get(target: T, prop: string | symbol, receiver: any) {
      const originalMethod = target[prop as keyof T];

      if (typeof originalMethod !== 'function') {
        return originalMethod;
      }

      if (String(prop) === getOperationStatusMethod) {
        return async function (this: any, ...args: any[]) {
          if (args.length !== 1) throw new Error('Expected only 1 argument. Did the interface got changed?');
          const cid = args[0];
          if (typeof cid !== 'string') throw new Error('Expected string argument. Did the interface got changed?');

          const operation = await storage.operation(cid);
          if (operation === undefined) throw new Error(`Operation with following cid not found: ${cid}`);

          return operation.outputs;
        };
      }

      const m = methodsToProxy.find((m) => m === String(prop));
      if (!m) {
        return originalMethod;
      }
      return async function (this: any, ...args: any[]) {
        const correlationId = generateCid();
        const pendingPlaceholder = wrappedResponse(String(prop), [correlationId]);

        const [storageOperation, inserted] = await storage.insert({
          inputs: args, // <- already contains idempotency key
          method: String(prop),
          outputs: pendingPlaceholder,
          cid: correlationId,
          status: 'in_progress',
        });

        if (!inserted) {
          // inputs already exist in DB
          return storageOperation.outputs;
        }

        new Promise((resolve: (o: OperationStatus) => void, reject) => {
          const status = originalMethod.apply(
            this === receiver ? target : this,
            args,
          ) as OperationStatus;

          resolve(status);
        }).then(
          (op) => storage.update(correlationId, dbStatus(op), op).then(() => sendCallbackIfNeeded(finP2PClient, String(prop), correlationId, op)),
          (error) => storage.update(correlationId, 'failed', wrappedResponse(String(prop), [correlationId, 1, String(error)])).then(() => sendCallbackIfNeeded(finP2PClient, String(prop), correlationId, wrappedResponse(String(prop), [correlationId, 1, String(error)]))),
        );

        return pendingPlaceholder;
      };
    },
  });
}

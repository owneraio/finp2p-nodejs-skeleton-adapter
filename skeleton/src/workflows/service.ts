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
} from '@owneraio/finp2p-adapter-models';
import { Operation as StorageOperation, Storage, generateCid } from './storage';
import { operationStatusToAPI } from '../routes/mapping';
import { ProxyConfig } from './config';

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
      return pendingOrError(cid => pendingPlan(cid, opMetadata), (cid, code, message) => rejectedPlan(code, message));
    case compiletimeMethodName<PaymentService>('getDepositInstruction'):
      return pendingOrError(cid => pendingDepositOperation(cid, opMetadata), (cid, code, message) => failedDepositOperation(code, message));
    default:
      return {
        // @ts-ignore
        // highly unlikely
        wrappedArgs: args,
      };
  }
};

const sendCallbackIfNeeded = (proxyConfig: ProxyConfig | undefined, methodName: string, cid: string, status: OperationStatus):  Promise<OperationStatus> => {
  if (proxyConfig?.sendCallback === undefined) { return Promise.resolve(status); }

  console.info(`Sending callback for method '${methodName}' with cid '${cid}'`);

  // @ts-ignore
  // complains, because operation status can in theory provide `strategy.type = polling` and send callback doesnt like it
  return proxyConfig.sendCallback(cid, operationStatusToAPI(status)).then(() => Promise.resolve(status));
};

export function createServiceProxy<T extends object>(
  migrationJob: () => Promise<void>,
  storage: Storage,
  proxyConfig: ProxyConfig | undefined,
  service: T,
  ...methodsToProxy: (keyof T)[]
): T {
  const opMetadata: OperationMetadata | undefined = proxyConfig?.sendCallback === undefined ? undefined : { responseStrategy: 'callback' };

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
                return sendCallbackIfNeeded(proxyConfig, op.method, op.cid, outputs);
              },
              (error: any) => {
                storage.update(op.cid, 'failed', wrappedResponse(op.method, opMetadata, [op.cid, 1, String(error)]));
                return sendCallbackIfNeeded(proxyConfig, op.method, op.cid, error as OperationStatus);
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
        const pendingPlaceholder = wrappedResponse(String(prop), opMetadata, [correlationId]);

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
          (op) => storage.update(correlationId, dbStatus(op), op).then(() => sendCallbackIfNeeded(proxyConfig, String(prop), correlationId, op)),
          (error) => {
            const wrp = wrappedResponse(String(prop), opMetadata, [correlationId, 1, String(error)]);

            return storage.update(correlationId, 'failed', wrp).then(() => sendCallbackIfNeeded(proxyConfig, String(prop), correlationId, wrp));
          },
        );

        return pendingPlaceholder;
      };
    },
  });
}

import {
  OperationStatus,
  CommonService,
  pendingPlan,
  pendingAssetCreation,
  pendingDepositOperation,
  pendingReceiptOperation,
} from '@owneraio/finp2p-adapter-models';
import { FinP2PClient } from '@owneraio/finp2p-client';
import { Operation as StorageOperation, Storage, generateCid } from './storage';

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

export function createServiceProxy<T extends object>(
  migrationJob: () => Promise<void>,
  storage: Storage,
  finP2PClient: FinP2PClient | undefined, // TODO: switch to callback oriented when tests are ready
  service: T,
  ...methodsToProxy: {
    name: keyof T;
    pendingState: (correlationId: string) => OperationStatus
  }[]
): T {
  methodsToProxy.forEach((m) => {
    const method = service[m.name];
    if (typeof method !== 'function') return;
    migrationJob()
      .then(() =>
        storage.operations({ status: 'in_progress', method: String(m.name) }).then(
          (operations) => {
            operations.forEach((op) => {
              method(...op.inputs).then(
                (outputs: OperationStatus) => {
                  storage.update(op.cid, dbStatus(outputs), outputs);
                  return outputs; // TODO: callback
                },
                (error: any) => {
                  storage.update(op.cid, 'failed', String(error));
                },
              );
            });
          },
          (error) => console.error(`Couldn'nt fetch pending operations: ${error}`),
        ),
      );
  });

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

      const m = methodsToProxy.find((m) => m.name === String(prop));
      if (!m) {
        return originalMethod;
      }
      return async function (this: any, ...args: any[]) {
        const correlationId = generateCid();
        const pendingPlaceholder = m.pendingState(correlationId);

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
          (op) => storage.update(correlationId, dbStatus(op), op),
          (error) => storage.update(correlationId, 'failed', String(error)),
        );

        return pendingPlaceholder;
      };
    },
  });
}

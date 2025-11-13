import {
  PaymentService,
  PlanApprovalService,
} from '@owneraio/finp2p-adapter-models';
import { Operation as StorageOperation, WorkflowStorage } from './storage';

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
      return 'failed';
    default:
      return 'unknown';
  }
};

const cidMapper = <
  T extends
  | { type: 'success' | 'pending' | 'failure'; correlationId?: string }
  | { type: 'approved' | 'rejected' | 'pending'; correlationId?: string },
>(
    storage: StorageOperation,
    obj: T,
  ): T => {
  switch (obj.type) {
    case 'failure':
    case 'success':
    case 'approved':
    case 'rejected':
      return obj;
    case 'pending':
      return {
        ...obj,
        correlationId: storage.cid,
      };
  }
};

type SupportedMethods = PaymentService['getDepositInstruction'] | PlanApprovalService['approvePlan'];
type WithThis<TThis, TFn extends (...args: any) => any> =
  (this: TThis, ...args: Parameters<TFn>) => ReturnType<TFn>;

export class WorkflowService {
  constructor(public storage: WorkflowStorage) { }

  async wrap<A, T extends WithThis<A, SupportedMethods>>(target: A, orig: T, args: OmitThisParameter<Parameters<T>>): Promise<Awaited<ReturnType<T>>> {
    const { cid } = await this.storage.insert({
      method: orig.name,
      status: 'queued',
      inputs: args,
      idempotency_key: args[0],
      outputs: {},
    });

    try {
      const result = await orig.apply(target, args);
      await this.storage.update(cid, dbStatus(result), result);
      return result as Awaited<ReturnType<T>>;
    } catch (error) {
      await this.storage.update(cid, 'failed', error);
      console.error(error);
      throw error;
    }
  }
}

// const tryExtractIdempotencyAndArgs = (args: unknown[], ifFound: (idempotencyKey: string, inputs: any) => void) => {
//   if (args.length < 1) return
//   const idem = args[0]
//   if (typeof idem !== 'string') return
// 
//   ifFound(idem, args.slice(1))
// }
// 
// export function wS<I extends object, T extends I>(storage: WorkflowStorage, target: T): I {
//   return new Proxy(target, {
//     get(t, p, r) {
//       const v = Reflect.get(t, p, r);
//       if (typeof v === "function") {
//         return (...args: unknown[]) => {
//           console.debug(String(p), args);
//           let chain = Promise.resolve()
//           tryExtractIdempotencyAndArgs(args, (idempotency_key, inputs) => {
//             chain = chain
//               .then(() => storage.insert({
//                 idempotency_key,
//                 inputs,
//                 outputs: {},
//                 method: String(p),
//                 status: 'queued'
//               }))
//               .then(() => { })
//           })
//           // preserve `this`
//           // eslint-disable-next-line @typescript-eslint/no-unsafe-return
//           const outputs = (v as Function).apply(t, args);
//           tryExtractIdempotencyAndArgs(args, (idempotency_key, inputs) => {
//             storage.update('123', 'succeeded', outputs)
//           })
//           return outputs
//         };
//       }
//       return v;
//     }
//   }) as I
// }
// 
// //const b: PlanApprovalService = wS(null as unknown as WorkflowStorage, null as unknown as PlanApprovalService)
// 
// export class WorkflowService
//   implements PlanApprovalService, CommonService, PaymentService {
//   constructor(
//     private storage: WorkflowStorage,
//     private commonService: CommonService,
//     private escrowService: EscrowService,
//     private healthService: HealthService,
//     private paymentService: PaymentService,
//     private planService: PlanApprovalService,
//     private tokenService: TokenService,
//   ) { }
// 
//   async getDepositInstruction(
//     ...args: Parameters<PaymentService['getDepositInstruction']>
//   ): ReturnType<PaymentService['getDepositInstruction']> {
//     return this.callMethod(
//       this.paymentService,
//       this.paymentService.getDepositInstruction,
//       {
//         args,
//         idempotencyKey: args[0],
//         dbMethod: 'getDepositInstruction',
//         dbStatus: dbStatus,
//         cidMapper,
//       },
//     );
//   }
// 
//   async payout(
//     ...args: Parameters<PaymentService['payout']>
//   ): ReturnType<PaymentService['payout']> {
//     return this.callMethod(this.paymentService, this.paymentService.payout, {
//       args,
//       idempotencyKey: args[0],
//       dbMethod: 'payout',
//       dbStatus,
//       cidMapper,
//     });
//   }
// 
//   async getReceipt(id: string): Promise<ReceiptOperation> {
//     return this.commonService.getReceipt(id);
//   }
// 
//   async approvePlan(
//     ...args: Parameters<PlanApprovalService['approvePlan']>
//   ): ReturnType<PlanApprovalService['approvePlan']> {
//     return this.callMethod(this.planService, this.planService.approvePlan, {
//       args,
//       idempotencyKey: args[0],
//       dbMethod: 'approvePlan',
//       dbStatus,
//       cidMapper,
//     });
//   }
// 
//   async operationStatus(cid: string): Promise<OperationStatus> {
//     const storageOperation = await this.storage.operation(cid);
//     if (!storageOperation) {
//       console.debug(
//         `Stored operation with CID ${cid} not found. Relaying to the original`,
//       );
//       return this.commonService.operationStatus(cid);
//     }
// 
//     const underlying = await this.commonService.operationStatus(
//       (storageOperation.outputs as { correlationId: string }).correlationId,
//     );
// 
//     const expected = {
//       'approval': 'approvePlan',
//       'deposit': 'getDepositInstruction',
//       'receipt': 'payout',
//       'createAsset': 'createAsset',
//     } as const;
// 
//     if (expected[underlying.operation] !== storageOperation.method) {
//       throw new Error(`Unexpected mapping: ${underlying.operation}`);
//     }
//     await this.storage.update(storageOperation.cid, dbStatus(underlying), underlying);
//     return cidMapper(storageOperation, underlying);
//   }
// 
//   protected async callMethod<
//     T,
//     F extends (this: T, ...args: any[]) => Promise<any>,
//   >(
//     obj: T,
//     fn: F,
//     opts: {
//       args: Parameters<OmitThisParameter<F>>;
//       idempotencyKey: string;
//       cidMapper: (
//         storage: StorageOperation,
//         result: Awaited<ReturnType<F>>,
//       ) => Awaited<ReturnType<F>>;
//       dbStatus: (obj: Awaited<ReturnType<F>>) => StorageOperation['status'];
//       dbMethod: string;
//     },
//   ): Promise<Awaited<ReturnType<F>>> {
//     let storageOperation = await this.storage.insert({
//       idempotency_key: opts.idempotencyKey,
//       inputs: opts.args,
//       method: opts.dbMethod,
//       outputs: {},
//       status: 'queued',
//     });
//     const result = await fn.apply(obj, opts.args);
//     const status = opts.dbStatus(result);
//     storageOperation = await this.storage.update(
//       storageOperation.cid,
//       status,
//       result,
//     );
// 
//     return opts.cidMapper(storageOperation, result);
//   }
// }

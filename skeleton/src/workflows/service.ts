import {
  CommonService,
  DepositOperation,
  EscrowService,
  HealthService,
  OperationStatus,
  PaymentService,
  PlanApprovalService,
  PlanApprovalStatus,
  ReceiptOperation,
  TokenService,
} from "@owneraio/finp2p-adapter-models";
import { Operation as StorageOperation, WorkflowStorage } from "./storage";

const dbStatus = <
  T extends
  | { type: "success" | "pending" | "failure" }
  | { type: "approved" | "rejected" | "pending" },
>(
  obj: T,
): StorageOperation["status"] => {
  switch (obj.type) {
    case "success":
    case "approved":
      return "succeeded";
    case "pending":
      return "in_progress";
    case "failure":
    case "rejected":
      return "failed";
  }
};

const cidMapper = <
  T extends
  | { type: "success" | "pending" | "failure"; correlationId?: string }
  | { type: "approved" | "rejected" | "pending"; correlationId?: string },
>(
  storage: StorageOperation,
  obj: T,
): T => {
  switch (obj.type) {
    case "failure":
    case "success":
    case "approved":
    case "rejected":
      return obj;
    case "pending":
      return {
        ...obj,
        correlationId: storage.cid,
      };
  }
};

export class WorkflowService
  implements PlanApprovalService, CommonService, PaymentService {
  constructor(
    private storage: WorkflowStorage,
    private commonService: CommonService,
    private escrowService: EscrowService,
    private healthService: HealthService,
    private paymentService: PaymentService,
    private planService: PlanApprovalService,
    private tokenService: TokenService,
  ) { }

  async getDepositInstruction(
    ...args: Parameters<PaymentService["getDepositInstruction"]>
  ): ReturnType<PaymentService["getDepositInstruction"]> {
    return this.callMethod(
      this.paymentService,
      this.paymentService.getDepositInstruction,
      {
        args,
        idempotencyKey: args[0],
        dbMethod: "getDepositInstruction",
        dbStatus: dbStatus,
        cidMapper,
      },
    );
  }

  async payout(
    ...args: Parameters<PaymentService["payout"]>
  ): ReturnType<PaymentService["payout"]> {
    return this.callMethod(this.paymentService, this.paymentService.payout, {
      args,
      idempotencyKey: args[0],
      dbMethod: "payout",
      dbStatus,
      cidMapper,
    });
  }

  async getReceipt(id: string): Promise<ReceiptOperation> {
    return this.commonService.getReceipt(id);
  }

  async approvePlan(
    ...args: Parameters<PlanApprovalService["approvePlan"]>
  ): ReturnType<PlanApprovalService["approvePlan"]> {
    return this.callMethod(this.planService, this.planService.approvePlan, {
      args,
      idempotencyKey: args[0],
      dbMethod: "approvePlan",
      dbStatus,
      cidMapper,
    });
  }

  async operationStatus(cid: string): Promise<OperationStatus> {
    const storageOperation = await this.storage.operation(cid);
    if (!storageOperation) {
      console.debug(
        `Stored operation with CID ${cid} not found. Relaying to the original`,
      );
      return this.commonService.operationStatus(cid);
    }

    const underlying = await this.commonService.operationStatus(
      (storageOperation.outputs as { correlationId: string }).correlationId,
    );

    const expected = {
      "approval": "approvePlan",
      "deposit": "getDepositInstruction",
      "receipt": "payout",
      "createAsset": "createAsset"
    } as const

    if (expected[underlying.operation] !== storageOperation.method) {
      throw new Error(`Unexpected mapping: ${underlying.operation}`)
    }
    await this.storage.update(storageOperation.cid, dbStatus(underlying), underlying)
    return cidMapper(storageOperation, underlying)
  }

  protected async callMethod<
    T,
    F extends (this: T, ...args: any[]) => Promise<any>,
  >(
    obj: T,
    fn: F,
    opts: {
      args: Parameters<OmitThisParameter<F>>;
      idempotencyKey: string;
      cidMapper: (
        storage: StorageOperation,
        result: Awaited<ReturnType<F>>,
      ) => Awaited<ReturnType<F>>;
      dbStatus: (obj: Awaited<ReturnType<F>>) => StorageOperation["status"];
      dbMethod: string;
    },
  ): Promise<Awaited<ReturnType<F>>> {
    let storageOperation = await this.storage.insert({
      idempotency_key: opts.idempotencyKey,
      inputs: opts.args,
      method: opts.dbMethod,
      outputs: {},
      status: "queued",
    });
    const result = await fn.apply(obj, opts.args);
    const status = opts.dbStatus(result);
    storageOperation = await this.storage.update(
      storageOperation.cid,
      status,
      result,
    );

    return opts.cidMapper(storageOperation, result);
  }
}

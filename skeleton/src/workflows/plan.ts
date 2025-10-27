import {
  Asset,
  CommonService,
  DepositAsset,
  DepositOperation,
  Destination,
  EscrowService,
  HealthService,
  OperationStatus,
  PaymentService,
  PlanApprovalService,
  PlanApprovalStatus,
  ReceiptOperation,
  Signature,
  Source,
  TokenService,
} from "../services";
import { WorkflowStorage, Operation as StorageOperation } from "./storage";

export class WorkflowPlanApprovalService
  implements PlanApprovalService, CommonService, PaymentService
{
  constructor(
    private storage: WorkflowStorage,
    private commonService: CommonService,
    private escrowService: EscrowService,
    private healthService: HealthService,
    private paymentService: PaymentService,
    private planService: PlanApprovalService,
    private tokenService: TokenService,
  ) {}

  async getDepositInstruction(
    ...args: Parameters<PaymentService["getDepositInstruction"]>
  ): ReturnType<PaymentService["getDepositInstruction"]> {
    return await this.callMethod(
      this.paymentService,
      this.paymentService.getDepositInstruction,
      {
        args,
        idempotencyKey: args[0],
        dbMethod: "getDepositInstruction",
        dbStatus: depositOperationStatusToDb,
        cidMapper: depositOperationCidMapper,
      },
    );
  }

  async payout(
    ...args: Parameters<PaymentService["payout"]>
  ): ReturnType<PaymentService["payout"]> {
    return await this.callMethod(
      this.paymentService,
      this.paymentService.payout,
      {
        args,
        idempotencyKey: args[0],
        dbMethod: "payout",
        dbStatus: receiptOperationStatusToDb,
        cidMapper: receiptOperationCidMapper,
      },
    );
  }

  async getReceipt(id: string): Promise<ReceiptOperation> {
    return await this.commonService.getReceipt(id);
  }

  async operationStatus(cid: string): Promise<OperationStatus> {
    const storageOperation = await this.storage.operation(cid);
    if (!storageOperation)
      throw new Error(`Operation with CID ${cid} not found`);

    switch (storageOperation.method) {
      case "approvePlan":
        const approvePlan = await this.commonService.operationStatus(
          (storageOperation.outputs as { correlationId: string }).correlationId,
        );
        if (approvePlan.operation !== "approval")
          throw new Error(
            `Expected PlanApprovalStatus, but found ${approvePlan.operation}`,
          );
        await this.storage.changeStatus(
          cid,
          planApprovalStatusToDb(approvePlan),
        );
        return planApprovalCidMapper(storageOperation, approvePlan);
      case "getDepositInstruction":
        const deposit = await this.commonService.operationStatus(
          (storageOperation.outputs as { correlationId: string }).correlationId,
        );
        if (deposit.operation !== "deposit")
          throw new Error(
            `Expected DepositOperation, but found ${deposit.operation}`,
          );
        await this.storage.changeStatus(
          cid,
          depositOperationStatusToDb(deposit),
        );
        return depositOperationCidMapper(storageOperation, deposit);
      case "payout":
        const payout = await this.commonService.operationStatus(
          (storageOperation.outputs as { correlationId: string }).correlationId,
        );
        if (payout.operation !== "receipt")
          throw new Error(
            `Expected DepositOperation, but found ${payout.operation}`,
          );
        await this.storage.changeStatus(
          cid,
          receiptOperationStatusToDb(payout),
        );
        return receiptOperationCidMapper(storageOperation, payout);
      default:
        throw new Error(`Unexpected method stored ${storageOperation.method}`);
    }
  }

  async approvePlan(
    ...args: Parameters<PlanApprovalService["approvePlan"]>
  ): ReturnType<PlanApprovalService["approvePlan"]> {
    return await this.callMethod(
      this.planService,
      this.planService.approvePlan,
      {
        args,
        idempotencyKey: args[0],
        dbMethod: "approvePlan",
        dbStatus: planApprovalStatusToDb,
        cidMapper: planApprovalCidMapper,
      },
    );
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
    const result = await fn.apply(obj, opts.args);
    const status = opts.dbStatus(result);
    const storageOperation = await this.storage.insert({
      idempotency_key: opts.idempotencyKey,
      inputs: opts.args,
      method: opts.dbMethod,
      outputs: result,
      status,
    });

    return opts.cidMapper(storageOperation, result);
  }
}

const planApprovalStatusToDb = (
  planStatus: PlanApprovalStatus,
): StorageOperation["status"] => {
  switch (planStatus.type) {
    case "pending":
      return "in_progress";
    case "rejected":
      return "succeeded";
    case "approved":
      return "succeeded";
    default:
      return "unknown";
  }
};

const planApprovalCidMapper = (
  storage: StorageOperation,
  planStatus: PlanApprovalStatus,
): PlanApprovalStatus => {
  switch (planStatus.type) {
    case "approved":
    case "rejected":
      return planStatus;
    case "pending":
      return {
        ...planStatus,
        correlationId: storage.cid,
      };
  }
};

const depositOperationStatusToDb = (
  result: DepositOperation,
): StorageOperation["status"] => {
  switch (result.type) {
    case "pending":
      return "in_progress";
    case "failure":
      return "failed";
    case "success":
      return "succeeded";
    default:
      return "unknown";
  }
};

const depositOperationCidMapper = (
  storage: StorageOperation,
  result: DepositOperation,
): DepositOperation => {
  switch (result.type) {
    case "success":
    case "failure":
      return result;
    case "pending":
      return {
        ...result,
        correlationId: storage.cid,
      };
  }
};

const receiptOperationStatusToDb = (
  result: ReceiptOperation,
): StorageOperation["status"] => {
  switch (result.type) {
    case "success":
      return "succeeded";
    case "pending":
      return "in_progress";
    case "failure":
      return "failed";
    default:
      return "unknown";
  }
};

const receiptOperationCidMapper = (
  storage: StorageOperation,
  result: ReceiptOperation,
): ReceiptOperation => {
  switch (result.type) {
    case "failure":
    case "success":
      return result;
    case "pending":
      return {
        ...result,
        correlationId: storage.cid,
      };
  }
};

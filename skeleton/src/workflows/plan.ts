import {
  CommonService,
  EscrowService,
  HealthService,
  OperationStatus,
  PaymentService,
  PlanApprovalService,
  PlanApprovalStatus,
  ReceiptOperation,
  TokenService,
} from "../services";
import { WorkflowStorage, Operation as StorageOperation } from "./storage";

export class WorkflowPlanApprovalService
  implements PlanApprovalService, CommonService
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

  async getReceipt(id: string): Promise<ReceiptOperation> {
    return await this.commonService.getReceipt(id);
  }

  async operationStatus(cid: string): Promise<OperationStatus> {
    const storageOperation = await this.storage.operation(cid);
    if (!storageOperation)
      throw new Error(`Operation with CID ${cid} not found`);

    switch (storageOperation.method) {
      case "approvePlan":
        const underlying = await this.commonService.operationStatus(
          (storageOperation.outputs as { correlationId: string }).correlationId,
        );
        if (underlying.operation !== "approval")
          throw new Error(
            `Expected PlanApprovalStatus, but found ${underlying.operation}`,
          );
        await this.storage.changeStatus(
          cid,
          planApprovalStatusToDb(underlying),
        );
        return planApprovalCidMapper(storageOperation, underlying);
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

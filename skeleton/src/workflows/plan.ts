import { PlanApprovalService, PlanApprovalStatus } from "../services";
import { WorkflowStorage } from "./storage";

export class WorkflowPlanApprovalService implements PlanApprovalService {
  constructor(
    private storage: WorkflowStorage,
    private impl: PlanApprovalService,
  ) {
    storage.operations({ status: 'in_progress', method: 'approvePlan' }).then(operations => {
      operations.forEach(op => "SHOULD BE IMPLEMENTED")
    })
  }

  async approvePlan(
    idempotencyKey: string,
    planId: string,
  ): Promise<PlanApprovalStatus> {
    const operation = await this.storage.insert({
      cid: null,
      arguments: { planId },
      method: "approvePlan",
      idempotency_key: idempotencyKey,
      status: "in_progress",
    });

    const result = await this.impl.approvePlan(idempotencyKey, planId);
    switch (result.type) {
      case "pending":
        await this.storage.changeCid(operation.id, result.correlationId)
        break
      case "approved":
        await this.storage.changeStatus(operation.id, "succeeded")
        break
      case "rejected":
        await this.storage.changeStatus(operation.id, "failed")
        break
    }

    return result;
  }
}

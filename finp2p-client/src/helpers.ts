import {components} from "./finapi/op-model-gen";


export const executionPlanApprovalStatus = (cid: string, approval: components["schemas"]["PlanApproved"] | components["schemas"]["PlanRejected"]): components["schemas"]["operationStatusApproval"] => {
  return {
    type: "approval",
    operation: {
      cid,
      isCompleted: true,
      approval,
      operationMetadata: undefined
    }
  }
}

import {logger} from '../../helpers';
import {approvedPlan, PlanApprovalService, PlanApprovalStatus} from '../index';
import {FinP2PClient} from "../../../../finp2p-client/src";
import {executionFromAPI} from "./mapper";
import {ValidationError} from "../errors";

export class PlanApprovalServiceImpl implements PlanApprovalService {

  finP2P: FinP2PClient

  constructor(finP2P: FinP2PClient) {
    this.finP2P = finP2P;
  }

  public async approvePlan(planId: string): Promise<PlanApprovalStatus> {
    logger.info(`Got execution plan to approve: ${planId}`);
    const { data } = await this.finP2P.getExecutionPlan(planId)
    if (!data) {
      throw new ValidationError(`No plan ${planId} found`);
    }
    const plan = executionFromAPI(data.plan)
    logger.info(`Approving execution plan: ${JSON.stringify(plan)}`);

    return approvedPlan();
  }

}

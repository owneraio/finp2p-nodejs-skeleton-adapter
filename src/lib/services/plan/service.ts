import {logger} from '../../helpers';
import {approvedPlan, ExecutionPlan, pendingPlan, PlanApprovalService, PlanApprovalStatus} from '../index';
import {ValidationError} from '../errors';
import {v4 as uuid} from 'uuid';
import {executionPlanApprovalStatus, FinP2PClient} from "@owneraio/finp2p-client";
import {executionFromAPI} from "./mapper";

export class PlanApprovalServiceImpl implements PlanApprovalService {

  finP2P?: FinP2PClient | undefined;

  constructor(finP2P: FinP2PClient | undefined) {
    this.finP2P = finP2P;
  }

  public async approvePlan(planId: string): Promise<PlanApprovalStatus> {
    logger.info(`Got execution plan to approve: ${planId}`);
    if (this.finP2P) {
      const {data} = await this.finP2P.getExecutionPlan(planId);
      if (!data) {
        logger.warn(`No plan ${planId} found`);
        throw new ValidationError(`No plan ${planId} found`);
      }
      const plan = executionFromAPI(data.plan);
      const cid = uuid();
      this.approve(cid, plan);

      return pendingPlan(cid, {responseStrategy: 'callback'});
    } else {
      logger.debug(`No FinP2P client, auto-approving plan`);
      return approvedPlan();
    }
  }

  private async approve(cid: string, plan: ExecutionPlan) {
    if (!this.finP2P) {
      throw new Error('FinP2P client not initialized');
    }
    //   TODO: implement real approval logic
    logger.info(`Approving execution plan: ${JSON.stringify(plan)}`);

    await this.finP2P.sendCallback(cid, executionPlanApprovalStatus(cid, {status: 'approved'}));
  }
}

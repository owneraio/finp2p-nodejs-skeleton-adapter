import {logger} from '../../helpers';
import {approvedPlan, ExecutionPlan, pendingPlan, PlanApprovalService, PlanApprovalStatus} from '../index';
import {ValidationError} from '../errors';
import {v4 as uuid} from 'uuid';
import {executionPlanApprovalStatus, FinP2PClient} from "@owneraio/finp2p-client";
import {executionFromAPI} from "./mapper";
import {PluginManager} from "../../plugins/manager";

export class PlanApprovalServiceImpl implements PlanApprovalService {

  finP2P: FinP2PClient | undefined;
  pluginManager: PluginManager | undefined

  constructor(pluginManager: PluginManager | undefined, finP2P?: FinP2PClient | undefined) {
    this.finP2P = finP2P;
    this.pluginManager = pluginManager;
  }

  public async approvePlan(planId: string): Promise<PlanApprovalStatus> {
    logger.info(`Got execution plan to approve: ${planId}`);
    if (this.finP2P && this.pluginManager) {
      const planApprovalPlugin = this.pluginManager.getPlanApprovalPlugin();
      if (planApprovalPlugin) {
        const {data} = await this.finP2P.getExecutionPlan(planId);
        if (!data) {
          logger.warn(`No plan ${planId} found`);
          throw new ValidationError(`No plan ${planId} found`);
        }
        const plan = executionFromAPI(data.plan);
        const cid = uuid();
        this.approve(cid, plan);

        return pendingPlan(cid, {responseStrategy: 'callback'});
      }
    }

    logger.debug(`No FinP2P client, auto-approving plan`);
    return approvedPlan();
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

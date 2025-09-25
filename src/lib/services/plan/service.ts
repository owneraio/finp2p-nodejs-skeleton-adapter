import {logger} from '../../helpers';
import {approvedPlan, ExecutionPlan, pendingPlan, PlanApprovalService, PlanApprovalStatus} from '../index';
import {ValidationError} from '../errors';
import {v4 as uuid} from 'uuid';
import {FinP2PClient} from "@owneraio/finp2p-client";
import {executionFromAPI} from "./mapper";
import {PluginManager} from "../../plugins/manager";
import {PlanApprovalPlugin} from "../../plugins/interfaces";

export class PlanApprovalServiceImpl implements PlanApprovalService {

  orgId: string
  finP2P: FinP2PClient | undefined;
  pluginManager: PluginManager | undefined

  constructor(orgId: string, pluginManager: PluginManager | undefined, finP2P?: FinP2PClient | undefined) {
    this.orgId = orgId;
    this.finP2P = finP2P;
    this.pluginManager = pluginManager;
  }

  public async approvePlan(idempotencyKey: string, planId: string): Promise<PlanApprovalStatus> {
    logger.info(`Got execution plan to approve: ${planId}`);
    if (this.finP2P) {
      const {data} = await this.finP2P.getExecutionPlan(planId);
      if (!data) {
        logger.warn(`No plan ${planId} found`);
        throw new ValidationError(`No plan ${planId} found`);
      }
      const plan = executionFromAPI(data.plan);
      logger.info(`Fetched plan data: ${JSON.stringify(plan)}`);

      if (this.pluginManager) {
        const plugin = this.pluginManager.getPlanApprovalPlugin();
        if (plugin) {
          return this.validatePlanUsingPlugin(idempotencyKey, plan, plugin)
        }
      }
    }

    logger.debug(`No FinP2P client, auto-approving plan`);
    return approvedPlan();
  }

  private validatePlanUsingPlugin(idempotencyKey: string, plan: ExecutionPlan, plugin: PlanApprovalPlugin): PlanApprovalStatus {
    const cid = uuid();

    const instructions = plan.instructions.filter(i => i.organizations.includes(this.orgId));
    for (const instruction of instructions) {
      const {operation} = instruction;
      switch (operation.type) {
        case "issue": {
          const {asset, destination, amount} = operation;
          if (!destination) {
            throw new ValidationError('No destination in primary sale');
          }
          if (destination.type !== 'finId') {
            throw new ValidationError('Only finId destination is supported in primary sale');
          }
          plugin.validateIssuance(idempotencyKey, cid, destination, asset, amount).then(() => {
            logger.info(`Plan ${plan.id} approved`);
          })
          break
        }
        case "transfer": {
          const {asset, source, destination, amount} = operation;
          if (source.type !== 'finId') {
            throw new ValidationError('Only finId destination is supported in primary sale');
          }
          plugin.validateTransfer(idempotencyKey, cid, source, destination, asset, amount).then(() => {
            logger.info(`Plan ${plan.id} approved`);
          })
          break
        }
        case "hold":
      }

    }
    // switch (plan.intentType) {
    //   case "primarySale":
    //     const {contract: {asset: {asset, destination, amount}}} = plan
    //     if (!destination) {
    //       throw new ValidationError('No destination in primary sale');
    //     }
    //     if (destination.type !== 'finId') {
    //       throw new ValidationError('Only finId destination is supported in primary sale');
    //     }
    //     const { finId: issuerFinId } = destination;
    //     plugin.validateIssuance(idempotencyKey, cid, asset.assetId, issuerFinId, amount).then(() => {
    //       logger.info(`Plan ${plan.id} approved`);
    //     })
    //   case "buyingIntent":
    //
    // }


    return pendingPlan(cid, {responseStrategy: 'callback'});

  }

}

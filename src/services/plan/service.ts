import { logger } from '../../helpers';
import {
  approvedPlan, Asset, DestinationAccount,
  ExecutionPlan,
  FinIdAccount, pendingPlan,
  PlanApprovalService,
  PlanApprovalStatus, rejectedPlan,
} from '../index';
import { v4 as uuid } from 'uuid';
import { FinP2PClient } from '@owneraio/finp2p-client';
import { executionFromAPI } from './mapper';
import { PluginManager } from '../../plugins';

export class PlanApprovalServiceImpl implements PlanApprovalService {

  orgId: string;

  finP2P: FinP2PClient | undefined;

  pluginManager: PluginManager | undefined;

  constructor(orgId: string, pluginManager: PluginManager | undefined, finP2P?: FinP2PClient | undefined) {
    this.orgId = orgId;
    this.finP2P = finP2P;
    this.pluginManager = pluginManager;
  }

  public async approvePlan(idempotencyKey: string, planId: string): Promise<PlanApprovalStatus> {
    logger.info(`Got execution plan to approve: ${planId}`);
    if (this.finP2P) {
      const { data } = await this.finP2P.getExecutionPlan(planId);
      if (!data) {
        logger.warn(`No plan ${planId} found`);
        return rejectedPlan(1, `No plan ${planId} found`);
      }
      const plan = executionFromAPI(data.plan);
      logger.info(`Fetched plan data: ${JSON.stringify(plan)}`);
      return this.validatePlan(idempotencyKey, plan);
    }

    logger.debug('No FinP2P client, auto-approving plan');
    return approvedPlan();
  }

  private validatePlan(idempotencyKey: string, plan: ExecutionPlan): Promise<PlanApprovalStatus> {

    const instructions = plan.instructions.filter(i => i.organizations.includes(this.orgId));
    for (const instruction of instructions) {
      const { operation } = instruction;
      switch (operation.type) {
        case 'issue': {
          const { asset, destination, amount } = operation;
          if (!destination) {
            return Promise.resolve(rejectedPlan(1, 'No destination in primary sale'));
          }
          if (destination.type !== 'finId') {
            return Promise.resolve(rejectedPlan(1, 'Only finId destination is supported in primary sale'));
          }
          return this.validateIssuance(idempotencyKey, destination, asset, amount);
        }

        case 'transfer': {
          const { asset, source, destination, amount } = operation;
          if (source.type !== 'finId') {
            return Promise.resolve(rejectedPlan(1, 'Only finId source is supported in transfer operation'));
          }
          return this.validateTransfer(idempotencyKey, source, destination, asset, amount);
        }

        case 'hold': {
          const { asset, source, destination, amount } = operation;
          if (source.type !== 'finId') {
            return Promise.resolve(rejectedPlan(1, 'Only finId source is supported in hold operation'));
          }
          if (!destination) {
            return Promise.resolve(rejectedPlan(1, 'No destination in hold operation'));
          }
          return this.validateTransfer(idempotencyKey, source, destination, asset, amount);
        }

        case 'redeem': {
          const { asset, source, destination, amount } = operation;
          if (source.type !== 'finId') {
            return Promise.resolve(rejectedPlan(1, 'Only finId source is supported in redemption'));
          }
          return this.validateRedemption(idempotencyKey, source, destination, asset, amount);
        }
      }
    }

    return Promise.resolve(approvedPlan());
  }

  validateIssuance(idempotencyKey: string, destination: FinIdAccount, asset: Asset, amount: string): Promise<PlanApprovalStatus> {
    if (this.pluginManager) {
      const plugin = this.pluginManager.getPlanApprovalPlugin();
      if (plugin) {
        if (plugin.isAsync) {
          if (!plugin.asyncIface) {
            return Promise.resolve(rejectedPlan(1, 'No async interface in plan approval plugin'));
          }
          const cid = uuid();
          plugin.asyncIface.validateIssuance(idempotencyKey, cid, destination, asset, amount)
            .then(() => {
            });
          return Promise.resolve(pendingPlan(cid, { responseStrategy: 'callback' }));
        } else {
          if (!plugin.syncIface) {
            return Promise.resolve(rejectedPlan(1, 'No async interface in plan approval plugin'));
          }
          return plugin.syncIface.validateIssuance(destination, asset, amount);
        }
      }
    }
    return Promise.resolve(approvedPlan());
  }

  validateTransfer(idempotencyKey: string, source: FinIdAccount, destination: DestinationAccount, asset: Asset, amount: string): Promise<PlanApprovalStatus> {
    if (this.pluginManager) {
      const plugin = this.pluginManager.getPlanApprovalPlugin();
      if (plugin) {
        if (plugin.isAsync) {
          if (!plugin.asyncIface) {
            return Promise.resolve(rejectedPlan(1, 'No async interface in plan approval plugin'));
          }
          const cid = uuid();
          plugin.asyncIface.validateTransfer(idempotencyKey, cid, source, destination, asset, amount).then(() => {
          });
          return Promise.resolve(pendingPlan(cid, { responseStrategy: 'callback' }));
        } else {
          if (!plugin.syncIface) {
            return Promise.resolve(rejectedPlan(1, 'No async interface in plan approval plugin'));
          }
          return plugin.syncIface.validateTransfer(source, destination, asset, amount);
        }
      }
    }
    return Promise.resolve(approvedPlan());
  }

  validateRedemption(idempotencyKey: string, source: FinIdAccount, destination: DestinationAccount | undefined, asset: Asset, amount: string): Promise<PlanApprovalStatus> {
    if (this.pluginManager) {
      const plugin = this.pluginManager.getPlanApprovalPlugin();
      if (plugin) {
        if (!plugin.isAsync) {
          if (!plugin.asyncIface) {
            return Promise.resolve(rejectedPlan(1, 'No async interface in plan approval plugin'));
          }
          const cid = uuid();
          plugin.asyncIface.validateRedemption(idempotencyKey, cid, source, destination, asset, amount).then(() => {
          });
          return Promise.resolve(pendingPlan(cid, { responseStrategy: 'callback' }));
        } else {
          if (!plugin.syncIface) {
            return Promise.resolve(rejectedPlan(1, 'No async interface in plan approval plugin'));
          }
          return plugin.syncIface.validateRedemption(source, destination, asset, amount);
        }
      }
    }
    return Promise.resolve(approvedPlan());
  }

}

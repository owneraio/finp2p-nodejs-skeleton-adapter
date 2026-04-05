import {
  approvedPlan, Asset, DestinationAccount,
  ExecutionPlan,
  FinIdAccount, InstructionResult,
  PlanApprovalService, PlanProposal, InboundTransferHook,
  PlanApprovalStatus, rejectedPlan,
} from '../../models';
import { FinP2PClient, OpComponents } from '@owneraio/finp2p-client';

import { executionFromAPI } from './mapper';
import { PluginManager } from '../../plugins';
import { logger } from '../../helpers';

const mapInstructionResult = (event?: OpComponents['schemas']['instructionCompletionEvent']): InstructionResult | undefined => {
  if (!event || !event.output) {
    return undefined;
  }
  const { output } = event;
  switch (output.type) {
    case 'receipt':
      return { type: 'receipt', transactionId: output.details.transactionDetails.transactionId };
    case 'error':
      return { type: 'error', code: output.code, message: output.message };
  }
};

export class PlanApprovalServiceImpl implements PlanApprovalService {

  orgId: string;

  finP2P: FinP2PClient | undefined;

  pluginManager: PluginManager | undefined;

  inboundTransferHook: InboundTransferHook | undefined;

  constructor(
    orgId: string,
    pluginManager: PluginManager | undefined,
    finP2P?: FinP2PClient | undefined,
    inboundTransferHook?: InboundTransferHook,
  ) {
    this.orgId = orgId;
    this.finP2P = finP2P;
    this.pluginManager = pluginManager;
    this.inboundTransferHook = inboundTransferHook;
  }

  private async fetchExecution(planId: string): Promise<OpComponents['schemas']['execution'] | undefined> {
    if (!this.finP2P) {
      return undefined;
    }
    const { data } = await this.finP2P.getExecutionPlan(planId);
    return data;
  }

  public async approvePlan(idempotencyKey: string, planId: string): Promise<PlanApprovalStatus> {
    logger.info(`Got execution plan to approve: ${planId}`);
    const execution = await this.fetchExecution(planId);
    if (execution) {
      const plan = executionFromAPI(execution.plan);
      logger.info(`Fetched plan data: ${JSON.stringify(plan)}`);
      return this.validatePlan(idempotencyKey, planId, plan);
    }
    if (this.finP2P) {
      logger.warning(`No plan ${planId} found`);
      return rejectedPlan(1, `No plan ${planId} found`);
    }

    logger.debug('No FinP2P client, auto-approving plan');
    return approvedPlan();
  }

  public async proposeCancelPlan(idempotencyKey: string, planId: string): Promise<PlanApprovalStatus> {
    logger.info(`Got cancel plan proposal: planId=${planId}`);
    return approvedPlan();
  }

  public async proposeResetPlan(idempotencyKey: string, planId: string, proposedSequence: number): Promise<PlanApprovalStatus> {
    logger.info(`Got reset plan proposal: planId=${planId}, proposedSequence=${proposedSequence}`);
    return approvedPlan();
  }

  public async proposeInstructionApproval(idempotencyKey: string, planId: string, instructionSequence: number): Promise<PlanApprovalStatus> {
    logger.info(`Got instruction approval proposal: planId=${planId}, instructionSequence=${instructionSequence}`);

    if (this.inboundTransferHook && this.finP2P) {
      const execution = await this.fetchExecution(planId);
      if (!execution) {
        return rejectedPlan(1, `No plan ${planId} found`);
      }

      const plan = executionFromAPI(execution.plan);
      const instruction = plan.instructions.find(i => i.sequence === instructionSequence);
      if (!instruction) {
        return rejectedPlan(1, `No instruction with sequence ${instructionSequence} in plan ${planId}`);
      }

      const { operation } = instruction;
      if (operation.type === 'transfer' &&
          instruction.organizations.includes(this.orgId)) {

        const event = execution.instructionsCompletionEvents
          ?.find(e => e.instructionSequenceNumber === instructionSequence);
        const result = mapInstructionResult(event);
        if (result) {
          await this.inboundTransferHook.onInboundTransfer(idempotencyKey, {
            planId,
            instructionSequence,
            source: operation.source,
            asset: operation.asset,
            destination: operation.destination,
            amount: operation.amount,
            result,
          });
        } else {
          logger.warning(`No completion event for instruction ${instructionSequence} in plan ${planId}, skipping hook`);
        }
      }
    }

    return approvedPlan();
  }

  public async proposalStatus(planId: string, proposal: PlanProposal, status: 'approved' | 'rejected'): Promise<void> {
    logger.info(`Got plan proposal status: planId=${planId}, type=${proposal.proposalType}, status=${status}`);
  }

  private async validatePlan(idempotencyKey: string, planId: string, plan: ExecutionPlan): Promise<PlanApprovalStatus> {
    const plugin = this.pluginManager?.getPlanApprovalPlugin();

    const instructions = plan.instructions.filter(i => i.organizations.includes(this.orgId));
    for (const instruction of instructions) {
      const { operation } = instruction;
      switch (operation.type) {
        case 'issue': {
          const { asset, destination, amount } = operation;
          if (!destination) {
            return rejectedPlan(1, 'No destination in primary sale');
          }
          if (destination.type !== 'finId') {
            return rejectedPlan(1, 'Only finId destination is supported in primary sale');
          }
          if (plugin) {
            return plugin.validateIssuance(destination, asset, amount);
          }
          break;
        }

        case 'transfer': {
          const { asset, source, destination, amount } = operation;
          if (source.type !== 'finId') {
            return rejectedPlan(1, 'Only finId source is supported in transfer operation');
          }
          if (this.inboundTransferHook) {
            await this.inboundTransferHook.onPlannedInboundTransfer(idempotencyKey, {
              planId, source, asset, destination, amount,
            });
          }
          if (plugin) {
            return plugin.validateTransfer(source, destination, asset, amount);
          }
          break;
        }

        case 'hold': {
          const { asset, source, destination, amount } = operation;
          if (source.type !== 'finId') {
            return rejectedPlan(1, 'Only finId source is supported in hold operation');
          }
          if (!destination) {
            return rejectedPlan(1, 'No destination in hold operation');
          }
          if (plugin) {
            return plugin.validateTransfer(source, destination, asset, amount);
          }
          break;
        }

        case 'redeem': {
          const { asset, source, destination, amount } = operation;
          if (source.type !== 'finId') {
            return rejectedPlan(1, 'Only finId source is supported in redemption');
          }
          if (plugin) {
            return plugin.validateRedemption(source, destination, asset, amount);
          }
          break;
        }
      }
    }

    return approvedPlan();
  }

}

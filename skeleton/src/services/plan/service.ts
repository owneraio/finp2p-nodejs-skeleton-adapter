import {
  approvedPlan,
  ExecutionPlan,
  InstructionResult, PlanFailureReason,
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
      if (operation.type === 'transfer') {
        const rawInstruction = execution.plan.instructions
          ?.find(i => i.sequence === instructionSequence);
        const isDestination =
          rawInstruction?.executionPlanOperation.type === 'transfer' &&
          rawInstruction.executionPlanOperation.destination.finp2pAccount.account.orgId === this.orgId;

        if (isDestination) {
          const event = execution.instructionsCompletionEvents
            ?.find(e => e.instructionSequenceNumber === instructionSequence);
          const result = mapInstructionResult(event);
          if (result) {
            await this.inboundTransferHook.onInboundTransfer(idempotencyKey, {
              planId,
              instructionSequence,
              sourceFinId: operation.source.finId,
              asset: operation.source.asset,
              destinationFinId: operation.destination.finId,
              amount: operation.amount,
              result,
            });
          } else {
            logger.warning(`No completion event for instruction ${instructionSequence} in plan ${planId}, skipping hook`);
          }
        }
      }
    }

    return approvedPlan();
  }

  public async proposalStatus(planId: string, proposal: PlanProposal, status: 'approved' | 'rejected'): Promise<void> {
    logger.info(`Got plan proposal status: planId=${planId}, type=${proposal.proposalType}, status=${status}`);

    const plugin = this.pluginManager?.getPlanApprovalPlugin();
    if (!plugin || !this.finP2P) return;

    const execution = await this.fetchExecution(planId);
    if (!execution) return;

    const planStatus = execution.executionPlanStatus;
    const terminalStatuses = ['completed', 'failed', 'halted', 'canceled'];
    if (!terminalStatuses.includes(planStatus)) return;

    const plan = executionFromAPI(execution.plan);

    try {
      if (planStatus === 'completed') {
        logger.info(`Plan completed: ${planId}`);
        await plugin.onPlanCompleted(planId, plan.intentType, plan.contract);
      } else {
        const reason = this.extractFailureReason(execution);
        logger.info(`Plan failed: ${planId}, status=${planStatus}`, { reason });
        await plugin.onPlanFailed(planId, plan.intentType, plan.contract, planStatus, reason);
      }
    } catch (e: any) {
      logger.error('Plan lifecycle callback failed', { planId, planStatus, error: e.message });
    }
  }

  private extractFailureReason(execution: OpComponents['schemas']['execution']): PlanFailureReason | undefined {
    const events = execution.instructionsCompletionEvents ?? [];
    for (const event of events) {
      if (event.output?.type === 'error') {
        return {
          instructionSequence: event.instructionSequenceNumber,
          code: event.output.code,
          message: event.output.message,
        };
      }
    }
    return undefined;
  }

  private async validatePlan(idempotencyKey: string, planId: string, plan: ExecutionPlan): Promise<PlanApprovalStatus> {
    const plugin = this.pluginManager?.getPlanApprovalPlugin();

    const instructions = plan.instructions.filter(i => i.organizations.includes(this.orgId));
    for (const instruction of instructions) {
      const { operation } = instruction;
      try {
        switch (operation.type) {
          case 'issue': {
            const { destination, amount } = operation;
            if (plugin) {
              return await plugin.validateIssuance(destination.finId, destination.asset, amount);
            }
            break;
          }

          case 'transfer': {
            const { source, destination, amount } = operation;
            if (this.inboundTransferHook) {
              await this.inboundTransferHook.onPlannedInboundTransfer(idempotencyKey, {
                planId,
                sourceFinId: source.finId,
                asset: source.asset,
                destinationFinId: destination.finId,
                amount,
              });
            }
            if (plugin) {
              return await plugin.validateTransfer(source.finId, destination.finId, source.asset, amount);
            }
            break;
          }

          case 'hold': {
            const { source, destination, amount } = operation;
            if (!destination) {
              return rejectedPlan(1, 'No destination in hold operation');
            }
            if (plugin) {
              return await plugin.validateTransfer(source.finId, destination.finId, source.asset, amount);
            }
            break;
          }

          case 'redeem': {
            const { source, destination, amount } = operation;
            if (plugin) {
              return await plugin.validateRedemption(source.finId, destination?.finId, source.asset, destination?.asset, amount);
            }
            break;
          }
        }
      } catch (e: any) {
        logger.error('Plan validation failed', { planId, sequence: instruction.sequence, operation: operation.type, error: e.message ?? e });
        return rejectedPlan(e.code ?? 1, e.message ?? String(e));
      }
    }

    return approvedPlan();
  }

}

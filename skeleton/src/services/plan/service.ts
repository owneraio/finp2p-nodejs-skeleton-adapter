import {
  approvedPlan,
  ExecutionPlan,
  InstructionResult, PlanFailureReason,
  PlanApprovalService, PlanProposal, InboundTransferHook,
  PlanApprovalStatus, rejectedPlan, ReleaseInstruction, TransferInstruction,
} from '../../models';
import { FinP2PClient, OpComponents } from '@owneraio/finp2p-client';

/**
 * Extract the org prefix from a FinP2P resource id of the form
 * `<orgId>:<type>:<uuid>`. Inlined here (rather than imported from
 * finp2p-client) so the skeleton runtime doesn't pull in finp2p-client
 * for a one-line operation — keeps the peer-dep purely typeful.
 */
function orgIdFromResource(resourceId: string): string {
  return resourceId.split(':', 1)[0];
}

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
      // Inbound hook fires for both `transfer` and `release` — both move value
      // from a source account to a destination account on a single asset, and
      // the adapter on the receiving side needs to observe either flavor.
      // Gate by the destination *asset*'s org (extracted from its resourceId)
      // rather than the destination account's orgId — the asset binding always
      // belongs to the destination side's org by construction in v0.28
      // cross-org DvP, and resourceId carries the prefix unconditionally.
      if (operation.type === 'transfer' || operation.type === 'release') {
        const op = operation as TransferInstruction | ReleaseInstruction;
        if (orgIdFromResource(op.destinationAsset.assetId) === this.orgId) {
          const event = execution.instructionsCompletionEvents
            ?.find(e => e.instructionSequenceNumber === instructionSequence);
          const result = mapInstructionResult(event);
          if (result) {
            await this.inboundTransferHook.onInboundTransfer(idempotencyKey, {
              planId,
              instructionSequence,
              sourceFinId: op.source.finId,
              // Use the destination-side asset binding: this hook fires only
              // when the adapter is on the receiving side, so the local
              // resource lives on `destination.finp2pAccount.asset`.
              asset: op.destinationAsset,
              destinationFinId: op.destination.finId,
              amount: op.amount,
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
            const { asset, destination, amount } = operation;
            if (plugin) {
              return await plugin.validateIssuance(destination.finId, asset, amount);
            }
            break;
          }

          case 'transfer': {
            const { asset, destinationAsset, source, destination, amount } = operation;
            // Hook fires only for the inbound side (we are the destination):
            // the adapter's local resource is on the destination's binding.
            // Gate via the destination asset's org prefix.
            if (this.inboundTransferHook && orgIdFromResource(destinationAsset.assetId) === this.orgId) {
              await this.inboundTransferHook.onPlannedInboundTransfer(idempotencyKey, {
                planId, sourceFinId: source.finId, asset: destinationAsset,
                destinationFinId: destination.finId, amount,
              });
            }
            if (plugin) {
              return await plugin.validateTransfer(source.finId, destination.finId, asset, amount);
            }
            break;
          }

          case 'release': {
            const { destinationAsset, source, destination, amount } = operation;
            // Same inbound-hook semantics as `transfer`: a release moves value
            // from a held position on the source side to the destination
            // account, so the destination's adapter needs to credit locally.
            if (this.inboundTransferHook && orgIdFromResource(destinationAsset.assetId) === this.orgId) {
              await this.inboundTransferHook.onPlannedInboundTransfer(idempotencyKey, {
                planId, sourceFinId: source.finId, asset: destinationAsset,
                destinationFinId: destination.finId, amount,
              });
            }
            // No plugin call — release isn't a separately validated op.
            break;
          }

          case 'hold': {
            const { asset, source, destination, amount } = operation;
            if (!destination) {
              return rejectedPlan(1, 'No destination in hold operation');
            }
            if (plugin) {
              return await plugin.validateTransfer(source.finId, destination.finId, asset, amount);
            }
            break;
          }

          case 'redeem': {
            const { asset, source, destination, amount } = operation;
            if (plugin) {
              return await plugin.validateRedemption(source.finId, destination?.finId, asset, undefined, amount);
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

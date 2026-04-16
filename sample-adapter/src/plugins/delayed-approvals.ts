import {
  PlanApprovalPlugin,
  PlanApprovalStatus,
  PlanFailureReason,
  PlanContract,
  IntentType,
  approvedPlan,
  Asset,
  DestinationAccount,
  FinIdAccount,
  Logger,
} from '@owneraio/finp2p-nodejs-skeleton-adapter';

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const defaultDelay = parseInt(process.env.APPROVAL_DELAY_MILLIS || '3000');

export class DelayedApprovals implements PlanApprovalPlugin {

  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  async validateIssuance(destination: FinIdAccount, asset: Asset, amount: string): Promise<PlanApprovalStatus> {
    this.logger.debug(`Approving issuance of ${amount} ${asset.assetId} to ${destination.finId}`);
    await sleep(defaultDelay);
    return approvedPlan();
  }

  async validateRedemption(source: FinIdAccount, destination: DestinationAccount | undefined, sourceAsset: Asset, destinationAsset: Asset | undefined, amount: string): Promise<PlanApprovalStatus> {
    this.logger.debug(`Approving redemption of ${amount} ${sourceAsset.assetId} from ${source.finId}`);
    await sleep(defaultDelay);
    return approvedPlan();
  }

  async validateTransfer(source: FinIdAccount, destination: DestinationAccount, sourceAsset: Asset, destinationAsset: Asset, amount: string): Promise<PlanApprovalStatus> {
    this.logger.debug(`Approving transfer of ${amount} ${sourceAsset.assetId} from ${source.finId}`);
    await sleep(defaultDelay);
    return approvedPlan();
  }

  async onPlanCompleted(planId: string, intentType: IntentType | undefined, contract: PlanContract): Promise<void> {
    this.logger.info(`Plan completed: ${planId}, intent=${intentType}`);
  }

  async onPlanFailed(planId: string, intentType: IntentType | undefined, contract: PlanContract, status: string, reason: PlanFailureReason | undefined): Promise<void> {
    this.logger.info(`Plan failed: ${planId}, intent=${intentType}, status=${status}, reason=${reason?.message ?? 'unknown'}`);
  }

}

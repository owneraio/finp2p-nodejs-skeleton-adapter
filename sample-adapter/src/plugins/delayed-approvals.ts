import {
  PlanApprovalPlugin,
  PlanApprovalStatus,
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

  async validateRedemption(source: FinIdAccount, destination: DestinationAccount | undefined, asset: Asset, amount: string): Promise<PlanApprovalStatus> {
    this.logger.debug(`Approving redemption of ${amount} ${asset.assetId} from ${source.finId}`);
    await sleep(defaultDelay);
    return approvedPlan();
  }

  async validateTransfer(source: FinIdAccount, destination: DestinationAccount, asset: Asset, amount: string): Promise<PlanApprovalStatus> {
    this.logger.debug(`Approving transfer of ${amount} ${asset.assetId} from ${source.finId}`);
    await sleep(defaultDelay);
    return approvedPlan();
  }

}

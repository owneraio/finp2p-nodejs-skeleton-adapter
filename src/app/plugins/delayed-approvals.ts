import { AsyncPlanApprovalPlugin } from '../../lib/plugins/interfaces';
import { Asset, DestinationAccount, FinIdAccount } from '../../lib/services';
import { AbstractPlugin } from '../../lib/plugins/abstract';


async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const defaultDelay = parseInt(process.env.APPROVAL_DELAY_MILLIS || '3000');

export class DelayedApprovals extends AbstractPlugin implements AsyncPlanApprovalPlugin {

  async validateIssuance(idempotencyKey: string, cid: string, destination: FinIdAccount, asset: Asset, amount: string): Promise<void> {
    this.logger.debug(`Approving issuance of ${amount} ${asset.assetId} to ${destination.finId}`);
    await sleep(defaultDelay);
    await this.sendOperationResult(cid, { operation: 'approval', type: 'approved' });
  }

  async validateRedemption(idempotencyKey: string, cid: string, source: FinIdAccount, destination: DestinationAccount | undefined, asset: Asset, amount: string): Promise<void> {
    this.logger.debug(`Approving redemption of ${amount} ${asset.assetId} from ${source.finId}`);
    await sleep(defaultDelay);
    await this.sendOperationResult(cid, { operation: 'approval', type: 'approved' });
  }

  async validateTransfer(idempotencyKey: string, cid: string, source: FinIdAccount, destination: DestinationAccount, asset: Asset, amount: string) {
    this.logger.debug(`Approving transfer of ${amount} ${asset.assetId} from ${source.finId} to ${destination.type} ${destination}`);
    await sleep(defaultDelay);
    await this.sendOperationResult(cid, { operation: 'approval', type: 'approved' });
  }

}

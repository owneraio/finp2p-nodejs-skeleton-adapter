import {
  failedDepositOperation,
  FinIdAccount,
  PaymentService,
  Asset,
  DepositAsset,
  DepositOperation,
  Destination, failedReceiptOperation, ReceiptOperation,
  Signature,
  Source,
} from '../../models';
import { logger } from '../../helpers';
import { PluginManager } from '../../plugins';


export class PaymentsServiceImpl implements PaymentService {

  pluginManager: PluginManager | undefined;

  constructor(pluginManager: PluginManager | undefined) {
    this.pluginManager = pluginManager;
  }

  public async getDepositInstruction(idempotencyKey: string, owner: Source, destination: Destination, asset: DepositAsset, amount: string | undefined, details: any | undefined,
    nonce: string | unknown, signature: Signature): Promise<DepositOperation> {

    switch (asset.assetType) {
      case 'custom':
        return this.depositCustom(owner.account, amount, details);
      default:
        return this.deposit(owner.account, destination, asset, amount);
    }
  }

  public async payout(idempotencyKey: string, source: Source, destination: Destination | undefined, asset: Asset, amount: string,
    description: string | undefined, nonce: string | undefined,
    signature: Signature | undefined): Promise<ReceiptOperation> {
    const plugin = this.pluginManager?.getPaymentsPlugin();
    if (!plugin) {
      return failedReceiptOperation(1, 'Payments are not supported');
    }
    if (!destination) {
      return failedReceiptOperation(1, 'No destination specified');
    }
    try {
      return await plugin.payout(source.account, destination.account, asset, amount);
    } catch (e: any) {
      logger.error('Payout plugin failed', { error: e.message ?? e });
      return failedReceiptOperation(e.code ?? 1, e.message ?? String(e));
    }
  }

  private async deposit(owner: FinIdAccount, destination: Destination, asset: DepositAsset, amount: string | undefined): Promise<DepositOperation> {
    const plugin = this.pluginManager?.getPaymentsPlugin();
    if (!plugin) {
      return failedDepositOperation(1, 'Deposits are not supported');
    }
    try {
      return await plugin.deposit(owner, asset, amount);
    } catch (e: any) {
      logger.error('Deposit plugin failed', { error: e.message ?? e });
      return failedDepositOperation(e.code ?? 1, e.message ?? String(e));
    }
  }

  private async depositCustom(owner: FinIdAccount, amount: string | undefined, details: any): Promise<DepositOperation> {
    const plugin = this.pluginManager?.getPaymentsPlugin();
    if (!plugin) {
      return failedDepositOperation(1, 'Custom deposits are not supported');
    }
    try {
      return await plugin.depositCustom(owner, amount, details);
    } catch (e: any) {
      logger.error('Custom deposit plugin failed', { error: e.message ?? e });
      return failedDepositOperation(e.code ?? 1, e.message ?? String(e));
    }
  }

}

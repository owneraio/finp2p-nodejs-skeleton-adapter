import {
  failedDepositOperation,
  FinIdAccount, generateCid,
  PaymentService,
  pendingDepositOperation, pendingReceiptOperation,
  Asset,
  DepositAsset,
  DepositOperation,
  Destination, failedReceiptOperation, ReceiptOperation,
  Signature,
  Source,
  PluginError,
} from '@owneraio/finp2p-adapter-models';
import { logger } from '../../helpers';
import { PluginManager } from '../../plugins';


export class PaymentsServiceImpl implements PaymentService {

  pluginManager: PluginManager | undefined;

  constructor(pluginManager: PluginManager | undefined) {
    this.pluginManager = pluginManager;
  }

  public async getDepositInstruction(idempotencyKey: string, owner: Source, destination: Destination, asset: DepositAsset, amount: string | undefined, details: any | undefined,
    nonce: string | unknown, signature: Signature): Promise<DepositOperation> {

    // const signer = owner.finId;
    // if (!await verifySignature(signature, signer)) {
    //   return failedDepositOperation(1, 'Signature verification failed');
    // }
    switch (asset.assetType) {
      case 'custom':
        return this.depositCustom(idempotencyKey, owner.account, amount, details);
      default:
        return this.deposit(idempotencyKey, owner.account, destination, asset, amount);
    }

  }

  public async payout(idempotencyKey: string, source: Source, destination: Destination | undefined, asset: Asset, amount: string,
    description: string | undefined, nonce: string | undefined,
    signature: Signature | undefined): Promise<ReceiptOperation> {
    if (!this.pluginManager) {
      return Promise.resolve(failedReceiptOperation(1, 'Custom deposits are not supported'));
    }
    const plugin = this.pluginManager.getPaymentsPlugin();
    if (!plugin) {
      logger.debug('No plugin found');
      return Promise.resolve(failedReceiptOperation(1, 'Custom deposits are not supported'));
    }

    if (!destination) {
      return Promise.resolve(failedReceiptOperation(1, 'No destination specified'));
    }
    // const signer = owner.finId;
    // if (!await verifySignature(signature, signer)) {
    //   return failedDepositOperation(1, 'Signature verification failed');
    // }

    if (plugin.isAsync) {
      if (!plugin.asyncIface) {
        return Promise.resolve(failedReceiptOperation(1, 'No async interface in plan approval plugin'));
      }
      const cid = generateCid();
      plugin.asyncIface.payout(idempotencyKey, cid, source.account, destination.account, asset, amount)
        .then(() => {
        }).catch(e => {
          if (e instanceof PluginError) {
            logger.error(`Plugin error: ${e.code}, message=${e.message}`);
          } else if (e instanceof Error) {
            logger.error(`Error in async deposit: ${e.message}`);
          } else {
            logger.error(`Error in async deposit: ${JSON.stringify(e)}`);
          }
        });
      return Promise.resolve(pendingReceiptOperation(cid, { responseStrategy: 'callback' }));
    } else {
      if (!plugin.syncIface) {
        return Promise.resolve(failedReceiptOperation(1, 'No sync interface in plan approval plugin'));
      }
      return plugin.syncIface.payout(source.account, destination.account, asset, amount);
    }
  }

  private async deposit(idempotencyKey: string, owner: FinIdAccount, destination: Destination, asset: DepositAsset, amount: string | undefined): Promise<DepositOperation> {
    if (!this.pluginManager) {
      return Promise.resolve(failedDepositOperation(1, 'Deposits are not supported'));
    }
    const plugin = this.pluginManager.getPaymentsPlugin();
    if (!plugin) {
      logger.debug('No plugin found');
      return Promise.resolve(failedDepositOperation(1, 'Custom deposits are not supported'));
    }
    if (plugin.isAsync) {
      if (!plugin.asyncIface) {
        return Promise.resolve(failedDepositOperation(1, 'No async interface in plan approval plugin'));
      }
      const cid = generateCid();
      plugin.asyncIface.deposit(idempotencyKey, cid, owner, asset, amount)
        .then(() => {
        }).catch(e => {
          if (e instanceof PluginError) {
            logger.error(`Plugin error: ${e.code}, message=${e.message}`);

          } else if (e instanceof Error) {
            logger.error(`Error in async deposit: ${e.message}`);
          } else {
            logger.error(`Error in async deposit: ${JSON.stringify(e)}`);
          }
        });
      return Promise.resolve(pendingDepositOperation(cid, { responseStrategy: 'callback' }));
    } else {
      if (!plugin.syncIface) {
        return Promise.resolve(failedDepositOperation(1, 'No sync interface in plan approval plugin'));
      }
      return plugin.syncIface.deposit(owner, asset, amount);
    }
  }

  private async depositCustom(idempotencyKey: string, owner: FinIdAccount, amount: string | undefined, details: any): Promise<DepositOperation> {
    if (!this.pluginManager) {
      return Promise.resolve(failedDepositOperation(1, 'Custom deposits are not supported'));
    }
    const plugin = this.pluginManager.getPaymentsPlugin();
    if (!plugin) {
      logger.debug('No plugin found');
      return Promise.resolve(failedDepositOperation(1, 'Custom deposits are not supported'));
    }
    if (plugin.isAsync) {
      if (!plugin.asyncIface) {
        return Promise.resolve(failedDepositOperation(1, 'No async interface in plan approval plugin'));
      }
      const cid = generateCid();
      plugin.asyncIface.depositCustom(idempotencyKey, cid, owner, amount, details)
        .then(() => {
        }).catch(e => {
          if (e instanceof PluginError) {
            logger.error(`Plugin error: ${e.code}, message=${e.message}`);
          } else if (e instanceof Error) {
            logger.error(`Error in async deposit: ${e.message}`);
          } else {
            logger.error(`Error in async deposit: ${JSON.stringify(e)}`);
          }
        });
      return Promise.resolve(pendingDepositOperation(cid, { responseStrategy: 'callback' }));
    } else {
      if (!plugin.syncIface) {
        return Promise.resolve(failedDepositOperation(1, 'No sync interface in plan approval plugin'));
      }
      return plugin.syncIface.depositCustom(owner, amount, details);
    }
  }


}

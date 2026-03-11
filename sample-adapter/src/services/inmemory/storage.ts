import { Asset, BusinessError } from '@owneraio/finp2p-adapter-models';
import { workflows } from '@owneraio/finp2p-nodejs-skeleton-adapter';
import { createHash } from 'node:crypto';
import { HoldOperation, Transaction } from './model';
import { Account } from './accounts';

function generateAdapterAccount(finId: string): string {
  return '0x' + createHash('sha256').update(finId).digest('hex').slice(0, 40);
}

export class Storage {

  assets: Record<string, Asset> = {};

  accounts: Record<string, Account> = {};

  holdOperations: Record<string, HoldOperation> = {};

  transactions: Record<string, Transaction> = {};

  registerTransaction(tx: Transaction) {
    this.transactions[tx.id] = tx;
  }

  getTransaction(id: string): Transaction | undefined {
    return this.transactions[id];
  }

  createAsset(assetId: string, asset: Asset) {
    this.assets[assetId] = asset;
  }

  checkAssetExists(assetId: string) {
    const asset = this.assets[assetId];
    if (asset === undefined) {
      throw new BusinessError(1, `Asset ${assetId} not found`);
    }
  }

  saveHoldOperation(operationId: string, finId: string, quantity: string) {
    this.holdOperations[operationId] = { finId, quantity };
  }

  getHoldOperation(operationId: string): HoldOperation | undefined {
    return this.holdOperations[operationId];
  }

  removeHoldOperation(operationId: string) {
    delete this.holdOperations[operationId];
  }

  getBalance(finId: string, assetId: string): string {
    this.checkAssetExists(assetId);
    let account = this.accounts[finId];
    if (account === undefined) {
      return '0';
    }
    const balance = account.balance(assetId);
    return `${balance}`;
  }

  debit(from: string, quantity: string, assetId: string) {
    this.checkAssetExists(assetId);
    this.getAccount(from).debit(assetId, quantity);
  }

  credit(to: string, quantity: string, assetId: string) {
    this.checkAssetExists(assetId);
    this.getOrCreateAccount(to).credit(assetId, quantity);
  }

  move(from: string, to: string, quantity: string, assetId: string) {
    this.checkAssetExists(assetId);
    this.getAccount(from).debit(assetId, quantity);
    this.getOrCreateAccount(to).credit(assetId, quantity);
  }

  getAccount(finId: string): Account {
    let account = this.accounts[finId];
    if (account === undefined) {
      throw new BusinessError(1, `Account ${finId} not found`);
    }
    return account;
  }

  getOrCreateAccount(finId: string): Account {
    let account = this.accounts[finId];
    if (account !== undefined) {
      return account;
    }
    const newAccount = new Account();
    this.accounts[finId] = newAccount;
    const adapterAccount = generateAdapterAccount(finId);
    workflows.saveAccountMapping(finId, adapterAccount).catch(() => {});
    return newAccount;
  }

}

import Asset = Components.Schemas.Asset;
import Source = Components.Schemas.Source;
import Destination = Components.Schemas.Destination;

export class Account {

  finId: string;

  balances: Record<string, number> = {};

  constructor(finId: string) {
    this.finId = finId;
  }

  balance(assetCode: string): number {
    return this.balances[assetCode] || 0;
  }

  debit(assetCode: string, amount: number) {
    this.balances[assetCode] = (this.balances[assetCode] || 0) - amount;
  }

  credit(assetCode: string, amount: number) {
    this.balances[assetCode] = (this.balances[assetCode] || 0) + amount;
  }
}

let service: AccountService;

export class AccountService {

  public static GetService(): AccountService {
    if (!service) {
      service = new AccountService();
    }
    return service;
  }

  accounts: Record<string, Account> = {};

  getBalance(id: string, asset: Asset): number {
    let account = this.accounts[id];
    if (account === undefined) {
      return 0;
    }
    let assetCode = AccountService.extractAssetCode(asset);
    return account.balance(assetCode);
  }

  debit(from: string, amount: number, asset: Asset) {
    let assetCode = AccountService.extractAssetCode(asset);
    this.getOrCreateAccount(from).debit(assetCode, amount);
  }

  credit(to: string, amount: number, asset: Asset) {
    let assetCode = AccountService.extractAssetCode(asset);
    this.getOrCreateAccount(to).credit(assetCode, amount);
  }

  move(from: string, to: string, amount: number, asset: Asset) {
    let assetCode = AccountService.extractAssetCode(asset);
    this.getOrCreateAccount(from).debit(assetCode, amount);
    this.getOrCreateAccount(to).credit(assetCode, amount);
  }

  createEscrowAccount(finId: string, escrowAccountId: string) {
    this.accounts[escrowAccountId] = new Account(finId);
  }

  getAccount(id: string): Account {
    return this.accounts[id];
  }

  getOrCreateAccount(id: string): Account {
    let account = this.accounts[id];
    if (account !== undefined) {
      return account;
    } else {
      const newAccount = new Account(id);
      this.accounts[id] = newAccount;
      return newAccount;
    }
  }

  static extractId(account: Source | Destination): string {
    switch (account.account.type) {
      case 'escrow':
        return account.account.escrowAccountId;
      case 'finId':
        return account.account.finId;
      default:
        return account.finId;
    }
  }

  static extractAssetCode(asset: Asset): string {
    switch (asset.type) {
      case 'cryptocurrency':
        return asset.code;
      case 'fiat':
        return asset.code;
      case 'finp2p':
        return asset.resourceId;
      default:
        throw new Error('unknown asset type');
    }
  }
}

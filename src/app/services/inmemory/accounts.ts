export class Account {

  balances: Record<string, number> = {};

  balance(assetCode: string): number {
    return this.balances[assetCode] || 0;
  }

  debit(assetCode: string, quantity: string) {
    if (this.balance(assetCode) < parseInt(quantity)) {
      throw new Error(`Insufficient balance for asset ${assetCode}`);
    }
    const amount = parseInt(quantity);
    this.balances[assetCode] = (this.balances[assetCode] || 0) - amount;
  }

  credit(assetCode: string, quantity: string) {
    const amount = parseInt(quantity);
    this.balances[assetCode] = (this.balances[assetCode] || 0) + amount;
  }
}

export class AccountService {

  accounts: Record<string, Account> = {};

  getBalance(finId: string, assetId: string): string {
    let account = this.accounts[finId];
    if (account === undefined) {
      return '0';
    }
    const balance = account.balance(assetId);
    return `${balance}`;
  }

  debit(from: string, quantity: string, assetId: string)  {
    this.getAccount(from).debit(assetId, quantity);
  }

  credit(to: string, quantity: string, assetId: string)  {
    this.getOrCreateAccount(to).credit(assetId, quantity);
  }

  move(from: string, to: string, quantity: string, assetId: string)  {
    this.getAccount(from).debit(assetId, quantity);
    this.getOrCreateAccount(to).credit(assetId, quantity);
  }

  getAccount(finId: string): Account {
    let account = this.accounts[finId];
    if (account === undefined) {
      throw new Error(`Account ${finId} not found`);
    }
    return account;
  }

  getOrCreateAccount(finId: string): Account {
    let account = this.accounts[finId];
    if (account !== undefined) {
      return account;
    } else {
      const newAccount = new Account();
      this.accounts[finId] = newAccount;
      return newAccount;
    }
  }

}

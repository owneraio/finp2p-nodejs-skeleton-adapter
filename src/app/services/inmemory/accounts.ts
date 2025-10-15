import { BusinessError } from '../../../lib/services';


export class Account {

  balances: Record<string, number> = {};

  balance(assetCode: string): number {
    return this.balances[assetCode] || 0;
  }

  debit(assetCode: string, quantity: string) {
    if (this.balance(assetCode) < parseInt(quantity)) {
      throw new BusinessError(1, `Insufficient balance for asset ${assetCode}`);
    }
    const amount = parseInt(quantity);
    this.balances[assetCode] = (this.balances[assetCode] || 0) - amount;
  }

  credit(assetCode: string, quantity: string) {
    const amount = parseInt(quantity);
    this.balances[assetCode] = (this.balances[assetCode] || 0) + amount;
  }
}

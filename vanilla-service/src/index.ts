import { Pool } from 'pg';
import {
  CommonService, EscrowService, HealthService, TokenService,
} from '@owneraio/finp2p-adapter-models';
import { ExternalTransferDelegate } from './interfaces';
import { LedgerStorage } from './storage';
import { ReceiptBuilder } from './receipt-builder';
import { TokenServiceImpl } from './token-service';
import { EscrowServiceImpl } from './escrow-service';
import { CommonServiceImpl } from './common-service';

export { ExternalTransferDelegate } from './interfaces';
export { LedgerStorage, LedgerTransaction, LedgerBalance, LedgerDetails } from './storage';
export { TokenServiceImpl } from './token-service';
export { EscrowServiceImpl } from './escrow-service';
export { CommonServiceImpl } from './common-service';
export { ReceiptBuilder } from './receipt-builder';

export interface LedgerConfig {
  connectionString: string;
}

export interface VanillaServices {
  tokenService: TokenService;
  escrowService: EscrowService;
  commonService: CommonService & HealthService;
}

/**
 * Creates vanilla service implementations backed by a PostgreSQL ledger.
 * The delegate handles external operations (on-chain transfers, proof generation).
 *
 * Usage:
 * ```
 * const { tokenService, escrowService, commonService } = createVanillaServices(myDelegate, { connectionString });
 * routes.register(app, tokenService, escrowService, commonService, commonService, ...);
 * ```
 */
export function createVanillaServices(delegate: ExternalTransferDelegate, config: LedgerConfig): VanillaServices {
  const pool = new Pool({ connectionString: config.connectionString });
  const storage = new LedgerStorage(pool);
  const receiptBuilder = new ReceiptBuilder();
  return {
    tokenService: new TokenServiceImpl(storage, delegate, receiptBuilder),
    escrowService: new EscrowServiceImpl(storage, delegate, receiptBuilder),
    commonService: new CommonServiceImpl(storage, pool),
  };
}

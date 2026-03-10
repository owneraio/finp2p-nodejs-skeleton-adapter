import { Pool } from 'pg';
import {
  CommonService, EscrowService, HealthService, OmnibusDelegate, TokenService,
} from '@owneraio/finp2p-adapter-models';
import { StorageConfig } from '../../workflows/config';
import { OmnibusStorage } from './storage';
import { ReceiptBuilder } from './receipt-builder';
import { OmnibusTokenService } from './token-service';
import { OmnibusEscrowService } from './escrow-service';
import { OmnibusCommonService } from './common-service';

export { OmnibusStorage, OmnibusTransaction, OmnibusBalance, LedgerDetails } from './storage';
export { OmnibusTokenService } from './token-service';
export { OmnibusEscrowService } from './escrow-service';
export { OmnibusCommonService } from './common-service';
export { ReceiptBuilder } from './receipt-builder';

export interface OmnibusServices {
  tokenService: TokenService;
  escrowService: EscrowService;
  commonService: CommonService & HealthService;
}

/**
 * Creates omnibus service implementations backed by a PostgreSQL ledger.
 * The delegate handles external operations (on-chain transfers, proof generation).
 * Uses the same StorageConfig (connection string) as the workflow layer — no extra pool needed.
 *
 * Usage:
 * ```
 * const { tokenService, escrowService, commonService } = createOmnibusServices(myDelegate, storageConfig);
 * routes.register(app, tokenService, escrowService, commonService, commonService, ...);
 * ```
 */
export function createOmnibusServices(delegate: OmnibusDelegate, config: StorageConfig): OmnibusServices {
  const pool = new Pool({ connectionString: config.connectionString });
  const storage = new OmnibusStorage(pool);
  const receiptBuilder = new ReceiptBuilder(delegate);
  return {
    tokenService: new OmnibusTokenService(storage, delegate, receiptBuilder),
    escrowService: new OmnibusEscrowService(storage, delegate, receiptBuilder),
    commonService: new OmnibusCommonService(storage, pool),
  };
}

import { Pool } from 'pg';
import {
  CommonService, EscrowService, HealthService, TokenService,
} from '@owneraio/finp2p-adapter-models';
import { EscrowDelegate, PayoutDelegate } from './interfaces';
import { LedgerStorage } from './storage';
import { VanillaServiceImpl } from './vanilla-service';

export { PayoutDelegate, EscrowDelegate, DelegateResult } from './interfaces';
export { LedgerStorage, LedgerTransaction, LedgerBalance, LedgerDetails } from './storage';
export { VanillaServiceImpl } from './vanilla-service';

export interface LedgerConfig {
  connectionString: string;
}

export interface VanillaServices {
  tokenService: TokenService;
  escrowService: EscrowService;
  commonService: CommonService & HealthService;
}

export interface VanillaDelegates {
  payout: PayoutDelegate;
  escrow?: EscrowDelegate;
}

/**
 * Creates vanilla service implementations backed by a PostgreSQL ledger.
 *
 * Usage:
 * ```
 * const services = createVanillaServices({ payout: myPayoutDelegate }, { connectionString });
 * // With optional escrow delegation:
 * const services = createVanillaServices({ payout, escrow: myEscrowDelegate }, { connectionString });
 * ```
 */
export function createVanillaServices(delegates: VanillaDelegates, config: LedgerConfig): VanillaServices {
  const pool = new Pool({ connectionString: config.connectionString });
  const storage = new LedgerStorage(pool);
  const service = new VanillaServiceImpl(storage, delegates.payout, pool, delegates.escrow);
  return {
    tokenService: service,
    escrowService: service,
    commonService: service,
  };
}

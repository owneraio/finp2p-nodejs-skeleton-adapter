import winston from 'winston';
import { Pool } from 'pg';
import {
  CommonService, EscrowService, HealthService, InboundTransferHook, MappingService, TokenService,
} from '@owneraio/finp2p-adapter-models';
import { AssetDelegate, EscrowDelegate, TransferDelegate } from './interfaces';
import { LedgerStorage } from './storage';
import { VanillaServiceImpl } from './service';
import { setLogger } from './logger';

export { AssetDelegate, TransferDelegate, EscrowDelegate, DelegateResult, InboundTransferVerificationError } from './interfaces';
export { LedgerStorage, LedgerTransaction, LedgerBalance, LedgerDetails } from './storage';
export { VanillaServiceImpl } from './service';
export { setLogger } from './logger';

export interface LedgerConfig {
  connectionString: string;
}

export interface VanillaServices {
  tokenService: TokenService;
  escrowService: EscrowService;
  commonService: CommonService & HealthService;
  mappingService: MappingService;
  inboundTransferHook?: InboundTransferHook;
}

export interface VanillaDelegates {
  transfer?: TransferDelegate;
  asset?: AssetDelegate;
  escrow?: EscrowDelegate;
}

/**
 * Creates vanilla service implementations backed by a PostgreSQL ledger.
 *
 * Usage:
 * ```
 * const services = createVanillaServices({ transfer: myTransferDelegate }, { connectionString });
 * // With optional escrow delegation:
 * const services = createVanillaServices({ transfer, escrow: myEscrowDelegate }, { connectionString });
 * ```
 */
export function createVanillaServices(delegates: VanillaDelegates, config: LedgerConfig, logger?: winston.Logger): VanillaServices {
  if (logger) {
    setLogger(logger);
  }
  const pool = new Pool({ connectionString: config.connectionString });
  const storage = new LedgerStorage(pool);
  const service = new VanillaServiceImpl(storage, delegates.transfer, delegates.asset, delegates.escrow);
  return {
    tokenService: service,
    escrowService: service,
    commonService: service,
    mappingService: service,
    inboundTransferHook: service,
  };
}

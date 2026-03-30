import path from 'node:path';
import winston from 'winston';
import { Pool } from 'pg';
import {
  CommonService, EscrowService, HealthService, InboundTransferHook, MappingService, TokenService,
} from '@owneraio/finp2p-nodejs-skeleton-adapter';
import { AssetDelegate, DistributionService, EscrowDelegate, OmnibusDelegate, TransferDelegate } from './interfaces';
import { LedgerStorage } from './storage';
import { VanillaServiceImpl } from './service';
import { setLogger } from './logger';

export { AssetDelegate, TransferDelegate, EscrowDelegate, OmnibusDelegate, DelegateResult, InboundTransferVerificationError, DistributionService, DistributionStatus } from './interfaces';
export { LedgerStorage, LedgerTransaction, LedgerBalance, LedgerDetails } from './storage';
export { VanillaServiceImpl } from './service';
export { registerDistributionRoutes } from './routes';
export { setLogger } from './logger';

/** Directory containing vanilla-service goose migration files */
export const migrationsDir = path.join(__dirname, '..', 'migrations');

/** Goose table name for vanilla-service migrations */
export const migrationsTableName = 'finp2p_vanilla_service_migrations';

export interface LedgerConfig {
  connectionString: string;
}

export interface VanillaServices {
  tokenService: TokenService;
  escrowService: EscrowService;
  commonService: CommonService & HealthService;
  mappingService: MappingService;
  distributionService?: DistributionService;
  inboundTransferHook?: InboundTransferHook;
}

export interface VanillaDelegates {
  transfer?: TransferDelegate;
  asset?: AssetDelegate;
  escrow?: EscrowDelegate;
  omnibus?: OmnibusDelegate;
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
  const service = new VanillaServiceImpl(storage, delegates.transfer, delegates.asset, delegates.escrow, delegates.omnibus);
  return {
    tokenService: service,
    escrowService: service,
    commonService: service,
    mappingService: service,
    distributionService: delegates.omnibus ? service : undefined,
    inboundTransferHook: service,
  };
}

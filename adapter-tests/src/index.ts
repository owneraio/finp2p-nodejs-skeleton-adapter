
import { businessLogicTests } from './business-logic.test';
import { tokenLifecycleTests } from './token-lifecycle.test';
import { insufficientBalanceTest } from './insufficient-balance.test';
import { mappingOperationsTests } from './mapping-operations.test';
import { LedgerProfile } from './utils/ledger-profile';

export * as callbackServer from './callback-server/server';
export { LedgerProfile, DEFAULT_LEDGER_PROFILE } from './utils/ledger-profile';

export interface AdapterTestConfig {
  mapping?: boolean;
  /**
   * Ledger-specific identifier formats (network, standard, tokenId generator)
   * and signing parameters. Merged over `global.ledgerProfile` (set by the
   * adapter's jest test environment) and the built-in EVM defaults.
   */
  ledger?: Partial<LedgerProfile>;
}

/**
 * `config.mapping` gates ONLY the mapping-CRUD test suite
 * (`mappingOperationsTests`) — depth-asserts on the mapping API that
 * on-chain-credential-only adapters can't satisfy.
 *
 * Actor pre-registration via `TestDataBuilder.buildActor` is independent
 * of this flag: it always POSTs the actor's `finId → ledgerAccountId`
 * to keep buildActor-style fixtures derivation-independent, and it's
 * idempotent for adapters that map-then-derive.
 */
export function runAdapterTests(config?: AdapterTestConfig) {
  describe('FinP2P Adapter Test Suite', () => {
    businessLogicTests(config?.ledger);
    tokenLifecycleTests(config?.ledger);
    insufficientBalanceTest(config?.ledger);
    if (config?.mapping) {
      mappingOperationsTests();
    }
  });
}


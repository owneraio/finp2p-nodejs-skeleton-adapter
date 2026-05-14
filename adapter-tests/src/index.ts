
import { businessLogicTests } from './business-logic.test';
import { tokenLifecycleTests } from './token-lifecycle.test';
import { insufficientBalanceTest } from './insufficient-balance.test';
import { mappingOperationsTests } from './mapping-operations.test';

export * as callbackServer from './callback-server/server';

export interface AdapterTestConfig {
  mapping?: boolean;
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
    businessLogicTests();
    tokenLifecycleTests();
    insufficientBalanceTest();
    if (config?.mapping) {
      mappingOperationsTests();
    }
  });
}


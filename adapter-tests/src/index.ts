
import { businessLogicTests } from './business-logic.test';
import { tokenLifecycleTests } from './token-lifecycle.test';
import { insufficientBalanceTest } from './insufficient-balance.test';
import { mappingOperationsTests } from './mapping-operations.test';

export * as callbackServer from './callback-server/server';

export interface AdapterTestConfig {
  mapping?: boolean;
}

export function runAdapterTests(config?: AdapterTestConfig) {
  describe('FinP2P Adapter Test Suite', () => {
    businessLogicTests(config);
    tokenLifecycleTests(config);
    insufficientBalanceTest(config);
    if (config?.mapping) {
      mappingOperationsTests();
    }
  });
}


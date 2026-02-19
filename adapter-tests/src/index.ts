
import { businessLogicTests } from './business-logic.test';
import { tokenLifecycleTests } from './token-lifecycle.test';
import { insufficientBalanceTest } from './insufficient-balance.test';

export * as callbackServer from './callback-server/server';
export * as plan from './plan';
export { LedgerAPIClient } from './api/api';

export function runAdapterTests(/*TODO: test configuration */) {
  describe('FinP2P Adapter Test Suite', () => {
    businessLogicTests();
    tokenLifecycleTests();
    insufficientBalanceTest();
  });
}


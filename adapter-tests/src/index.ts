
import { businessLogicTests } from './business-logic.test';
import { tokenLifecycleTests } from './token-lifecycle.test';
import { insufficientBalanceTests } from './insufficient-balance.test';
import { TestConfig } from './config';

export * as plan from './plan';
export { MockServer } from './mock-server';
export { LedgerAPIClient } from './api/api';
export { TestHelpers, ReceiptAssertions, BalanceAssertions } from './utils/test-assertions';
export { TestSetup } from './utils/test-setup';
export { escrowOperationsTests } from './escrow-operations.test';
export type { TestConfig } from './config';

export function runAdapterTests(config: TestConfig) {
  describe('FinP2P Adapter Test Suite', () => {
    tokenLifecycleTests(config);
    businessLogicTests(config);
    insufficientBalanceTests(config);
  });
}

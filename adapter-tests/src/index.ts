
import { businessLogicTests } from './business-logic.test';
import { tokenLifecycleTests } from './token-lifecycle.test';
import { insufficientBalanceTest } from './insufficient-balance.test';

export function runSkeletonTests() {
  describe('FinP2P Skeleton Conformance Suite', () => {
    businessLogicTests();
    tokenLifecycleTests();
    insufficientBalanceTest();
  });
}


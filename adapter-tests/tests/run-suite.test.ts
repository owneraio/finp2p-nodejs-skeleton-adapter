
import { businessLogicTests } from '../src/business-logic.test';
import { tokenLifecycleTests } from '../src/token-lifecycle.test';
import { insufficientBalanceTest } from '../src/insufficient-balance.test';

describe('FinP2P Adapter Test Suite', () => {
  businessLogicTests();
  tokenLifecycleTests();
  insufficientBalanceTest();
});

import { FinP2PNetwork } from './plan/plan-network';

export interface TestConfig {
  /** Network with at least one registered node. */
  network: FinP2PNetwork;
  /** Mock server URL (lazy getter for environments where URL is known only after beforeAll). */
  mockServerUrl: string | (() => string);
  /** Organization ID for generating test asset IDs. */
  orgId: string;
}

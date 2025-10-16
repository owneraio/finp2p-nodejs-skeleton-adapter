/**
 * Test constants for amounts, currencies, and other magic values
 * Centralized location makes it easy to adjust test data
 */

/**
 * Standard test amounts for token operations
 */
export const TEST_AMOUNTS = {
  // Issue amounts
  INITIAL_ISSUE: 1000,
  ISSUE_SETTLEMENT: 10000,

  // Transfer amounts
  TRANSFER: 600,
  TRANSFER_SETTLEMENT: 6000,

  // Escrow amounts
  ESCROW_HOLD: 100,
  ESCROW_SETTLEMENT: 1000,

  // Redemption amounts
  REDEEM: 100,
  REDEEM_SETTLEMENT: 1000,

  // Balance amounts
  INITIAL_BALANCE: 1000,
  ZERO_BALANCE: 0,
} as const;

/**
 * Settlement and currency codes
 */
export const CURRENCIES = {
  USD: 'USD',
  EUR: 'EUR',
  GBP: 'GBP',
} as const;

/**
 * Common blockchain addresses
 */
export const ADDRESSES = {
  ZERO_ADDRESS: '0x0000000000000000000000000000000000000000',
} as const;

/**
 * Chain IDs for different networks
 */
export const CHAIN_IDS = {
  ETHEREUM_MAINNET: 1,
  ETHEREUM_SEPOLIA: 11155111,
  POLYGON_MAINNET: 137,
  LOCAL_TESTNET: 1337,
} as const;

/**
 * Common actor names for test scenarios
 */
export const ACTOR_NAMES = {
  ISSUER: 'issuer',
  BUYER: 'buyer',
  SELLER: 'seller',
  INVESTOR: 'investor',
  ALICE: 'alice',
  BOB: 'bob',
  CHARLIE: 'charlie',
} as const;

/**
 * Timeout values for async operations
 */
export const TIMEOUTS = {
  DEFAULT_RETRY: 30,
  LONG_RETRY: 3000,
  POLL_INTERVAL_MS: 500,
} as const;

/**
 * Common test scenarios amounts
 */
export const SCENARIOS = {
  ISSUE_TRANSFER_REDEEM: {
    ISSUE_AMOUNT: 1000,
    ISSUE_SETTLEMENT: 10000,
    TRANSFER_AMOUNT: 600,
    TRANSFER_SETTLEMENT: 6000,
    EXPECTED_SELLER_BALANCE: 400, // 1000 - 600
    EXPECTED_BUYER_BALANCE: 600,
  },

  ESCROW_HOLD_RELEASE: {
    INITIAL_BALANCE: 1000,
    HOLD_AMOUNT: 100,
    SETTLEMENT_AMOUNT: 1000,
    EXPECTED_AFTER_HOLD: 0, // 1000 - 1000
    EXPECTED_AFTER_RELEASE: 1000,
  },

  ESCROW_HOLD_REDEEM: {
    ISSUE_AMOUNT: 100,
    REDEEM_AMOUNT: 100,
    SETTLEMENT_AMOUNT: 1000,
    EXPECTED_AFTER_REDEEM: 0, // 100 - 100
  },
} as const;

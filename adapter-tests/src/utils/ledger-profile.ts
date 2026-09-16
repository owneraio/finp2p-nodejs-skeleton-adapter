import { ADDRESSES } from './test-constants';

/**
 * Ledger-specific identifier formats and signing parameters, supplied by the
 * adapter under test. The suite fabricates test assets from this profile, so
 * an EVM adapter can hand out hex token addresses and `eip155:*` networks,
 * a Solana adapter base58 mints and `solana:*` networks, etc.
 *
 * Resolution order (later wins):
 * 1. built-in EVM defaults (`DEFAULT_LEDGER_PROFILE`)
 * 2. `global.ledgerProfile` — published by the adapter's jest test environment,
 *    next to `global.serverAddress`
 * 3. the `ledger` field of `runAdapterTests(config)`
 */
export interface LedgerProfile {
  /** CAIP-2 network id used in ledger identifiers, e.g. `eip155:1`, `solana:mainnet` */
  network: string;
  /** Token standard reported in ledger identifiers, e.g. `ERC20`, `spl-token` */
  standard?: string;
  /** Produces a ledger-native tokenId (hex address, base58 mint, ...) for a fabricated test asset */
  generateTokenId: (assetId: string) => string;
  /** EIP-712 signing domain used for request signatures */
  chainId: number;
  verifyingContract: string;
}

export const DEFAULT_LEDGER_PROFILE: LedgerProfile = {
  network: 'eip155:1',
  standard: 'ERC20',
  generateTokenId: (assetId) => assetId,
  chainId: 1,
  verifyingContract: ADDRESSES.ZERO_ADDRESS,
};

export const resolveLedgerProfile = (override?: Partial<LedgerProfile>): LedgerProfile => ({
  ...DEFAULT_LEDGER_PROFILE,
  // @ts-ignore
  ...(global.ledgerProfile as Partial<LedgerProfile> | undefined),
  ...override,
});

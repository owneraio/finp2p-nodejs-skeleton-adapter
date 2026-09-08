import { JsonRpcProvider } from 'ethers';

declare global {
  /* eslint-disable no-var, vars-on-top */
  var startPostgresContainer: () => Promise<{ connectionString: string, cleanup: () => Promise<void> }>;
  var startAnvilContainer: () => Promise<{ rpcUrl: string, cleanup: () => Promise<void> }>;
  var whichGoose: () => Promise<string>;
  /* eslint-enable no-var, vars-on-top */
}

/**
 * Provider tuned for tests against a paused-automining anvil: short polling
 * interval, no result caching so receipt/nonce reads see freshly mined blocks
 * immediately.
 */
export function testProvider(rpcUrl: string): JsonRpcProvider {
  const provider = new JsonRpcProvider(rpcUrl, undefined, { cacheTimeout: -1, pollingInterval: 100 });
  return provider;
}

export async function mine(provider: JsonRpcProvider, blocks: number = 1): Promise<void> {
  await provider.send('anvil_mine', [`0x${blocks.toString(16)}`]);
}

export async function setAutomine(provider: JsonRpcProvider, on: boolean): Promise<void> {
  await provider.send('evm_setAutomine', [on]);
}

export async function dropTransaction(provider: JsonRpcProvider, hash: string): Promise<void> {
  await provider.send('anvil_dropTransaction', [hash]);
}

export async function setBalance(provider: JsonRpcProvider, address: string, wei: bigint): Promise<void> {
  await provider.send('anvil_setBalance', [address, `0x${wei.toString(16)}`]);
}

export async function setNextBlockBaseFee(provider: JsonRpcProvider, wei: bigint): Promise<void> {
  await provider.send('anvil_setNextBlockBaseFeePerGas', [`0x${wei.toString(16)}`]);
}

export async function pendingTxHashes(provider: JsonRpcProvider): Promise<string[]> {
  const content = await provider.send('txpool_content', []);
  const hashes: string[] = [];
  for (const byAccount of Object.values(content.pending ?? {})) {
    for (const tx of Object.values(byAccount as Record<string, { hash: string }>)) {
      hashes.push(tx.hash);
    }
  }
  return hashes;
}

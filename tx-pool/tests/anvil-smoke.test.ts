import { Wallet, parseEther } from 'ethers';
import { testProvider, mine, setBalance, dropTransaction, pendingTxHashes } from './anvil';

describe('anvil test environment', () => {
  let container: { rpcUrl: string, cleanup: () => Promise<void> };

  beforeAll(async () => {
    container = await global.startAnvilContainer();
  });

  afterAll(async () => {
    await container.cleanup();
  });

  test('automining is paused: tx stays in mempool until anvil_mine', async () => {
    const provider = testProvider(container.rpcUrl);
    const wallet = new Wallet(Wallet.createRandom().privateKey, provider);
    await setBalance(provider, wallet.address, parseEther('10'));

    const resp = await wallet.sendTransaction({ to: wallet.address, value: 1n });
    expect(await provider.getTransactionReceipt(resp.hash)).toBeNull();
    expect(await pendingTxHashes(provider)).toContain(resp.hash);

    await mine(provider);
    const receipt = await provider.getTransactionReceipt(resp.hash);
    expect(receipt).not.toBeNull();
    expect(receipt!.status).toBe(1);
    provider.destroy();
  });

  test('anvil_dropTransaction removes a pending tx', async () => {
    const provider = testProvider(container.rpcUrl);
    const wallet = new Wallet(Wallet.createRandom().privateKey, provider);
    await setBalance(provider, wallet.address, parseEther('10'));

    const resp = await wallet.sendTransaction({ to: wallet.address, value: 1n });
    await dropTransaction(provider, resp.hash);
    expect(await pendingTxHashes(provider)).not.toContain(resp.hash);
    await mine(provider);
    expect(await provider.getTransactionReceipt(resp.hash)).toBeNull();
    provider.destroy();
  });
});

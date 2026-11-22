import { relatedSwapFromAPI } from '../../src/routes/mapping';
import { components } from '../../src/routes/model-gen';

const finId = (n: string) => n.padEnd(66, '0');
const ledgerIdentifier = {
  assetIdentifierType: 'CAIP-19', network: 'eip155:1', standard: 'ERC20', tokenId: '0x01',
} as const;

const account = (owner: string, assetId: string): components['schemas']['ledgerAccountAsset'] => ({
  finp2pAccount: {
    account: { type: 'finId', finId: finId(owner), orgId: 'org1' },
    asset: { type: 'finp2p', resourceId: assetId, ledgerIdentifier },
  },
} as any);

const leg = (from: string, to: string, assetId: string, amount: string): components['schemas']['swapInstructionLeg'] => ({
  source: account(from, assetId),
  destination: account(to, assetId),
  amount,
});

const relatedSwap = (deadline?: number): components['schemas']['relatedInstruction'] => ({
  type: 'swap',
  swapOperationId: 'plan_3',
  asset: leg('01', '02', 'org1:102:asset', '10'),
  settlement: leg('02', '01', 'org1:102:settlement', '20'),
  ...(deadline === undefined ? {} : { deadline }),
});

describe('relatedSwapFromAPI', () => {
  test('maps both legs and carries the swap deadline', () => {
    const swap = relatedSwapFromAPI(relatedSwap(1795349071));
    expect(swap.swapOperationId).toBe('plan_3');
    expect(swap.deadline).toBe(1795349071);
    expect(swap.asset.source.finId).toBe(finId('01'));
    expect(swap.asset.destination.finId).toBe(finId('02'));
    expect(swap.asset.amount).toBe('10');
    expect(swap.settlement.asset.assetId).toBe('org1:102:settlement');
  });

  test('a swap without a deadline maps to an undefined deadline', () => {
    expect(relatedSwapFromAPI(relatedSwap()).deadline).toBeUndefined();
  });
});

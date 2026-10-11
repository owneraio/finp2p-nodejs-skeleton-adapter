import { receiptToAPI, swapLegFromAPI } from '../../src/routes/mapping';
import { components } from '../../src/routes/model-gen';
import { ExecutionContext, Receipt } from '../../src/models';

const finId = (n: string) => n.padEnd(66, '0');
const ledgerIdentifier = {
  assetIdentifierType: 'CAIP-19', network: 'eip155:1', standard: 'ERC20', tokenId: '0x01',
} as const;
const api = (resourceId: string): components['schemas']['asset'] => ({ resourceId, ledgerIdentifier });

const OWN_ASSET = 'org1:102:asset';
const CP_ASSET = 'org2:102:asset';
const OWN_SETTLEMENT = 'org1:102:settlement';
const CP_SETTLEMENT = 'org2:102:settlement';

// Router's view of one swap from org1's perspective: org1 sends `asset`, receives `settlement`.
const assetLeg: components['schemas']['swapAssetLeg'] = {
  source: { finId: finId('01'), asset: api(OWN_ASSET) },
  destination: { finId: finId('02'), asset: api(CP_ASSET) },
  quantity: '10',
  signature: { template: { type: 'hashList', hashGroups: [], hash: '' }, signature: '', hashFunc: 'sha3-256' } as any,
};
const settlementLeg: components['schemas']['swapSettlementLeg'] = {
  source: { finId: finId('02'), asset: api(CP_SETTLEMENT) },
  destination: { finId: finId('01'), asset: api(OWN_SETTLEMENT) },
  quantity: '20',
};

describe('swapLegFromAPI', () => {
  test('asset leg: our binding is the source side', () => {
    const leg = swapLegFromAPI(assetLeg, 'source');
    expect(leg.asset.assetId).toBe(OWN_ASSET);
    expect(leg.source.finId).toBe(finId('01'));
    expect(leg.destination.finId).toBe(finId('02'));
  });

  test('settlement leg: our binding is the destination side (mirrored)', () => {
    const leg = swapLegFromAPI(settlementLeg, 'destination');
    expect(leg.asset.assetId).toBe(OWN_SETTLEMENT);
    expect(leg.source.finId).toBe(finId('02'));
    expect(leg.destination.finId).toBe(finId('01'));
    expect(leg.signature).toBeUndefined();
  });
});

describe('receiptToAPI counterparty side', () => {
  const executionContext = {
    planId: 'plan', sequence: 1, counterpartyAssetId: CP_ASSET, counterpartySettlementId: CP_SETTLEMENT,
  };
  const receipt = (assetId: string, direction: ExecutionContext['direction']): Receipt => ({
    id: 'r', quantity: '1', timestamp: 0, operationType: 'swap', proof: undefined,
    asset: { assetId, assetType: 'finp2p', ledgerIdentifier },
    source: { finId: finId('0a') }, destination: { finId: finId('0b') },
    tradeDetails: { executionContext: { ...executionContext, direction } },
    transactionDetails: { transactionId: 'tx', operationId: 'op' },
  });

  test('outbound (asset leg): counterpartyAssetId lands on destination', () => {
    const r = receiptToAPI(receipt(OWN_ASSET, 'outbound'));
    expect(r.source?.asset.resourceId).toBe(OWN_ASSET);
    expect(r.destination?.asset.resourceId).toBe(CP_ASSET);
  });

  test('inbound (settlement leg): counterpartySettlementId lands on source', () => {
    const r = receiptToAPI(receipt(OWN_SETTLEMENT, 'inbound'));
    expect(r.source?.asset.resourceId).toBe(CP_SETTLEMENT);
    expect(r.destination?.asset.resourceId).toBe(OWN_SETTLEMENT);
  });

  test('no direction (transfer): outbound', () => {
    const r = receiptToAPI(receipt(OWN_ASSET, undefined));
    expect(r.source?.asset.resourceId).toBe(OWN_ASSET);
    expect(r.destination?.asset.resourceId).toBe(CP_ASSET);
  });
});

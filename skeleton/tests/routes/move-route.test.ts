import express, { Application } from 'express';
import { Server } from 'http';
import axios from 'axios';
import { register } from '../../src/routes/routes';
import { receiptToAPI } from '../../src/routes/mapping';
import { createServiceProxy, WorkflowStorage } from '../../src/workflows';
import {
  Asset,
  CommonService,
  Destination,
  EscrowService,
  ExecutionContext,
  HealthService,
  PaymentService,
  PlanApprovalService,
  Receipt,
  ReceiptOperation,
  Signature,
  Source,
  TokenService,
} from '../../src/models';
import { components } from '../../src/routes/model-gen';

const finId = (n: string) => n.padEnd(66, '0');
const ledgerIdentifier = {
  assetIdentifierType: 'CAIP-19', network: 'eip155:1', standard: 'ERC20', tokenId: '0x01',
} as const;

const SRC_ASSET = 'bank-x:102:dtcc-classic';
const DST_ASSET = 'bank-x:102:besu';
const SRC_FINID = finId('01');
const DST_FINID = finId('02');

const apiAsset = (resourceId: string): components['schemas']['asset'] => ({ resourceId, ledgerIdentifier });

const signature: components['schemas']['signature'] = {
  template: { type: 'hashList', hashGroups: [], hash: '' },
  signature: '0xsig',
  hashFunc: 'sha3-256',
} as any;

const moveBody: components['schemas']['MoveAssetsRequest'] = {
  nonce: '0xnonce',
  operationId: 'op-1',
  source: { finId: SRC_FINID, asset: apiAsset(SRC_ASSET), ledgerAccount: { type: 'walletAccount', address: '0xaaa' } },
  destination: { finId: DST_FINID, asset: apiAsset(DST_ASSET) },
  quantity: '100',
  signature,
  executionContext: { executionPlanId: 'plan-1', instructionSequenceNumber: 3 },
};

/** What the route handed the service, captured so the test can assert the mapping. */
type MoveCall = {
  idempotencyKey: string; nonce: string; source: Source; destination: Destination;
  asset: Asset; destinationAsset: Asset; quantity: string; signature: Signature;
  operationId: string | undefined; exCtx: ExecutionContext | undefined;
};

const receiptFor = (call: MoveCall): Receipt => ({
  id: 'r-1',
  asset: call.asset,
  destinationAsset: call.destinationAsset,
  source: call.source,
  destination: call.destination,
  quantity: call.quantity,
  operationType: 'move',
  tradeDetails: { executionContext: call.exCtx },
  transactionDetails: { transactionId: 'tx-1', operationId: call.operationId },
  proof: undefined,
  timestamp: 0,
});

/** A TokenService that implements nothing but what the move route touches. */
class MovingTokenService {
  calls: MoveCall[] = [];

  async move(idempotencyKey: string, nonce: string, source: Source, destination: Destination, asset: Asset,
    destinationAsset: Asset, quantity: string, signature: Signature, operationId: string | undefined,
    exCtx: ExecutionContext | undefined): Promise<ReceiptOperation> {
    const call: MoveCall = {
      idempotencyKey, nonce, source, destination, asset, destinationAsset,
      quantity, signature, operationId, exCtx,
    };
    this.calls.push(call);
    return { operation: 'receipt', type: 'success', receipt: receiptFor(call) };
  }
}

/** An adapter whose ledger has no conversion: `move` is simply absent. */
class StillTokenService {}

const stub = <T>() => ({} as T);

describe('POST /api/assets/move', () => {
  let server: Server;
  let base: string;

  const start = (app: Application) => new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address();
      base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
      resolve();
    });
  });

  const mount = async (tokenService: unknown) => {
    const app = express();
    app.use(express.json());
    register(app, tokenService as TokenService, stub<EscrowService>(), stub<CommonService>(),
      stub<HealthService>(), stub<PaymentService>(), stub<PlanApprovalService>());
    await start(app);
  };

  afterEach(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  test('maps the request onto TokenService.move', async () => {
    const service = new MovingTokenService();
    await mount(service);

    const res = await axios.post(`${base}/api/assets/move`, moveBody, {
      headers: { 'Idempotency-Key': 'idem-1' },
    });

    expect(res.status).toBe(200);
    expect(service.calls).toHaveLength(1);
    const call = service.calls[0];
    expect(call.idempotencyKey).toBe('idem-1');
    expect(call.nonce).toBe('0xnonce');
    expect(call.operationId).toBe('op-1');
    expect(call.quantity).toBe('100');
    expect(call.source.finId).toBe(SRC_FINID);
    expect(call.destination.finId).toBe(DST_FINID);
    // The whole point of move: the two bindings differ, and the destination one
    // is not reconstructed from the source.
    expect(call.asset.assetId).toBe(SRC_ASSET);
    expect(call.destinationAsset.assetId).toBe(DST_ASSET);
    expect(call.exCtx).toEqual(expect.objectContaining({ planId: 'plan-1', sequence: 3 }));
  });

  test('carries the source ledger account through', async () => {
    const service = new MovingTokenService();
    await mount(service);

    await axios.post(`${base}/api/assets/move`, moveBody, { headers: { 'Idempotency-Key': 'idem-2' } });

    expect(service.calls[0].source.account).toEqual({ type: 'walletAccount', address: '0xaaa' });
  });

  test('the receipt names the destination binding, not the source one', async () => {
    await mount(new MovingTokenService());

    const res = await axios.post(`${base}/api/assets/move`, moveBody, {
      headers: { 'Idempotency-Key': 'idem-3' },
    });

    const receipt = res.data.response;
    expect(receipt.operationType).toBe('move');
    expect(receipt.source.asset.resourceId).toBe(SRC_ASSET);
    expect(receipt.destination.asset.resourceId).toBe(DST_ASSET);
  });

  test('a move across organizations is refused before the adapter sees it', async () => {
    const service = new MovingTokenService();
    await mount(service);

    const crossOrg = { ...moveBody, destination: { ...moveBody.destination, asset: apiAsset('bank-y:102:besu') } };
    const res = await axios.post(`${base}/api/assets/move`, crossOrg, {
      headers: { 'Idempotency-Key': 'idem-5' },
      validateStatus: () => true,
    });

    expect(res.status).toBe(200);
    expect(res.data.isCompleted).toBe(true);
    expect(res.data.error.message).toMatch(/one organization/);
    expect(service.calls).toHaveLength(0);
  });

  test('an adapter without move answers a failed receipt, not 404', async () => {
    await mount(new StillTokenService());

    const res = await axios.post(`${base}/api/assets/move`, moveBody, {
      headers: { 'Idempotency-Key': 'idem-4' },
      validateStatus: () => true,
    });

    expect(res.status).toBe(200);
    expect(res.data.isCompleted).toBe(true);
    expect(res.data.error.message).toMatch(/not supported/i);
  });
});

describe('move through the workflow proxy', () => {
  /** Enough WorkflowStorage for the proxy's two call sites, with no PostgreSQL. */
  const fakeStorage = (saved: any[]) => ({
    getPendingOperations: async () => [],
    saveOperation: async (op: any) => {
      saved.push(op);
      return [op, true];
    },
    completeOperation: async () => undefined,
  }) as unknown as WorkflowStorage;

  test("'move' is a known proxied method, so it gets a pending receipt", async () => {
    const saved: any[] = [];
    const service = new MovingTokenService();
    // `wrappedResponse` throws on a method it does not know, so a proxied `move`
    // that was never added there would fail here rather than return pending.
    const proxied = createServiceProxy(async () => undefined, fakeStorage(saved), undefined,
      service as unknown as TokenService, 'move');

    const result = await proxied.move!('idem-5', '0xnonce', { finId: SRC_FINID }, { finId: DST_FINID },
      { assetId: SRC_ASSET, assetType: 'finp2p', ledgerIdentifier },
      { assetId: DST_ASSET, assetType: 'finp2p', ledgerIdentifier },
      '100', signature as unknown as Signature, 'op-1', undefined);

    expect(result).toEqual(expect.objectContaining({ operation: 'receipt', type: 'pending' }));
    expect(saved).toHaveLength(1);
    expect(saved[0].method).toBe('move');
  });

  test('an absent move stays absent through the proxy', () => {
    const proxied = createServiceProxy(async () => undefined, fakeStorage([]), undefined,
      new StillTokenService() as unknown as TokenService, 'move');

    // The route's "not supported" branch is reached by this being undefined; a
    // proxy that handed back a wrapper for every name would hide it.
    expect(proxied.move).toBeUndefined();
  });
});

describe('receiptToAPI with an explicit destination binding', () => {
  const DST_LEDGER = {
    assetIdentifierType: 'CAIP-19', network: 'eip155:11155111', standard: 'ERC20', tokenId: '0x3ff8',
  } as const;
  const SRC_LEDGER = {
    assetIdentifierType: 'CAIP-19', network: 'dtcc', standard: 'DTCC_CLASSIC', tokenId: 'MCKUSTB4W',
  } as const;

  const base = (extra: Partial<Receipt>): Receipt => ({
    id: 'r-1',
    asset: { assetId: SRC_ASSET, assetType: 'finp2p', ledgerIdentifier: SRC_LEDGER },
    source: { finId: SRC_FINID },
    destination: { finId: DST_FINID },
    quantity: '100',
    operationType: 'move',
    tradeDetails: { executionContext: undefined },
    transactionDetails: { transactionId: 'tx-1', operationId: undefined },
    proof: undefined,
    timestamp: 0,
    ...extra,
  });

  test('the destination carries its OWN ledgerIdentifier, not the source one', () => {
    const r = receiptToAPI(base({
      destinationAsset: { assetId: DST_ASSET, assetType: 'finp2p', ledgerIdentifier: DST_LEDGER },
    }));

    expect(r.source?.asset.resourceId).toBe(SRC_ASSET);
    expect(r.source?.asset.ledgerIdentifier).toEqual(SRC_LEDGER);
    expect(r.destination?.asset.resourceId).toBe(DST_ASSET);
    // The bug this fixes: the destination used to inherit the source's
    // ledgerIdentifier under the destination's resourceId, so the router saw an
    // ERC20 resource described as a DTCC_CLASSIC token.
    expect(r.destination?.asset.ledgerIdentifier).toEqual(DST_LEDGER);
  });

  test('it works with no executionContext at all', () => {
    const r = receiptToAPI(base({
      tradeDetails: { executionContext: undefined },
      destinationAsset: { assetId: DST_ASSET, assetType: 'finp2p', ledgerIdentifier: DST_LEDGER },
    }));

    // A direct move has no plan, so there is no counterpartyAssetId to ride on.
    expect(r.destination?.asset.resourceId).toBe(DST_ASSET);
    expect(r.destination?.asset.ledgerIdentifier).toEqual(DST_LEDGER);
  });

  test('it beats the executionContext when both are present', () => {
    const r = receiptToAPI(base({
      tradeDetails: { executionContext: { planId: 'p', sequence: 1, counterpartyAssetId: 'other:102:asset' } },
      destinationAsset: { assetId: DST_ASSET, assetType: 'finp2p', ledgerIdentifier: DST_LEDGER },
    }));

    expect(r.destination?.asset.resourceId).toBe(DST_ASSET);
  });

  test('without it, transfer and swap keep inferring from the executionContext', () => {
    const r = receiptToAPI(base({
      operationType: 'transfer',
      tradeDetails: { executionContext: { planId: 'p', sequence: 1, counterpartyAssetId: DST_ASSET } },
    }));

    // Unchanged behaviour: both sides bind the same on-chain token, so sharing
    // the ledgerIdentifier under the counterparty's resourceId is correct.
    expect(r.destination?.asset.resourceId).toBe(DST_ASSET);
    expect(r.destination?.asset.ledgerIdentifier).toEqual(SRC_LEDGER);
  });
});

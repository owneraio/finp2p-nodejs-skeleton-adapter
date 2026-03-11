import { Pool } from 'pg';
import {
  Asset, Destination, ReceiptOperation, Signature, Source,
  finIdDestination,
} from '@owneraio/finp2p-adapter-models';
import { DelegateResult, EscrowDelegate, TransferDelegate } from '../src/interfaces';
import { LedgerStorage } from '../src/storage';
import { VanillaServiceImpl } from '../src/service';
import { runMigrations } from './migrate';

const dummySig = {} as Signature;

function expectSuccess(result: ReceiptOperation) {
  expect(result.type).toBe('success');
  if (result.type !== 'success') throw new Error('not success');
  return result;
}

function expectFailure(result: ReceiptOperation) {
  expect(result.type).toBe('failure');
  if (result.type !== 'failure') throw new Error('not failure');
  return result;
}

describe('vanilla services', () => {
  let container: { connectionString: string; cleanup: () => Promise<void> };
  let pool: Pool;
  let storage: LedgerStorage;
  let service: VanillaServiceImpl;

  let payoutCalls: Array<{ idempotencyKey: string; source: Source; destination: Destination; sourceAsset: Asset; destinationAsset: Asset; quantity: string }>;
  let payoutResult: DelegateResult;

  const mockDelegate: TransferDelegate = {
    async outboundTransfer(idempotencyKey, source, destination, sourceAsset, destinationAsset, quantity, _exCtx) {
      payoutCalls.push({ idempotencyKey, source, destination, sourceAsset, destinationAsset, quantity });
      return payoutResult;
    },
  };

  const asset: Asset = { assetId: 'bond-1', assetType: 'finp2p' };
  const aliceSource: Source = { finId: 'alice', account: { type: 'finId', finId: 'alice' } };
  const bobDest = finIdDestination('bob');
  const cryptoDest: Destination = { finId: 'ext-wallet', account: { type: 'crypto', address: '0xABC' } };

  let ikCounter = 0;
  const nextIk = () => `ik-svc-${Date.now()}-${++ikCounter}`;

  beforeEach(async () => {
    // @ts-ignore
    container = await global.startPostgresContainer();
    // @ts-ignore
    const goosePath = await global.whichGoose();
    await runMigrations(goosePath, container.connectionString);
    pool = new Pool({ connectionString: container.connectionString });
    storage = new LedgerStorage(pool);
    service = new VanillaServiceImpl(storage, mockDelegate);

    payoutCalls = [];
    payoutResult = { success: true, transactionId: 'ext-tx-1' };
  });

  afterEach(async () => {
    if (pool) await pool.end();
    if (container) await container.cleanup();
  });

  // ─── token transfer: external payout ──────────────────────────────────

  describe('token transfer to external destination (payout)', () => {
    beforeEach(async () => {
      await storage.ensureAccount('alice', asset.assetId, asset.assetType);
      await storage.credit('alice', '1000', asset.assetId, { idempotency_key: nextIk() });
    });

    test('successful payout: locks, calls delegate, unlocks and debits', async () => {
      const result = await service.transfer(
        nextIk(), 'nonce', aliceSource, cryptoDest, asset, asset, '200', dummySig, undefined,
      );

      const success = expectSuccess(result);
      expect(success.receipt).toBeDefined();
      expect(payoutCalls).toHaveLength(1);
      expect(payoutCalls[0].quantity).toBe('200');

      const bal = await storage.getBalance('alice', asset.assetId);
      expect(bal.balance).toBe('800');
      expect(bal.held).toBe('0');
      expect(bal.available).toBe('800');
    });

    test('successful payout: receipt contains external transaction ID', async () => {
      payoutResult = { success: true, transactionId: 'chain-tx-42' };

      const result = await service.transfer(
        nextIk(), 'nonce', aliceSource, cryptoDest, asset, asset, '100', dummySig, undefined,
      );

      const success = expectSuccess(result);
      expect(success.receipt.transactionDetails?.transactionId).toBe('chain-tx-42');
    });

    test('failed payout: locks then unlocks — balance fully restored', async () => {
      payoutResult = { success: false, error: 'chain reverted' };

      const result = await service.transfer(
        nextIk(), 'nonce', aliceSource, cryptoDest, asset, asset, '300', dummySig, undefined,
      );

      const failure = expectFailure(result);
      expect(failure.error).toBeDefined();
      expect(payoutCalls).toHaveLength(1);

      const bal = await storage.getBalance('alice', asset.assetId);
      expect(bal.balance).toBe('1000');
      expect(bal.held).toBe('0');
      expect(bal.available).toBe('1000');
    });

    test('failed payout: error message is propagated', async () => {
      payoutResult = { success: false, error: 'insufficient gas' };

      const result = await service.transfer(
        nextIk(), 'nonce', aliceSource, cryptoDest, asset, asset, '50', dummySig, undefined,
      );

      const failure = expectFailure(result);
      expect(failure.error.message).toBe('insufficient gas');
    });
  });

  // ─── token transfer: internal (finId) ─────────────────────────────────

  describe('token transfer to finId (local)', () => {
    beforeEach(async () => {
      await storage.ensureAccount('alice', asset.assetId, asset.assetType);
      await storage.ensureAccount('bob', asset.assetId, asset.assetType);
      await storage.credit('alice', '500', asset.assetId, { idempotency_key: nextIk() });
    });

    test('moves funds locally, does not call payout delegate', async () => {
      const result = await service.transfer(
        nextIk(), 'nonce', aliceSource, bobDest, asset, asset, '100', dummySig, undefined,
      );

      expectSuccess(result);
      expect(payoutCalls).toHaveLength(0);

      const aliceBal = await storage.getBalance('alice', asset.assetId);
      const bobBal = await storage.getBalance('bob', asset.assetId);
      expect(aliceBal.balance).toBe('400');
      expect(bobBal.balance).toBe('100');
    });
  });

  // ─── escrow: hold → release → rollback (all local) ───────────────────

  describe('escrow (local operations)', () => {
    beforeEach(async () => {
      await storage.ensureAccount('alice', asset.assetId, asset.assetType);
      await storage.ensureAccount('bob', asset.assetId, asset.assetType);
      await storage.credit('alice', '1000', asset.assetId, { idempotency_key: nextIk() });
    });

    test('hold locks funds', async () => {
      const operationId = 'op-1';
      const result = await service.hold(
        nextIk(), 'nonce', aliceSource, bobDest, asset, '400',
        dummySig, operationId, undefined,
      );

      expectSuccess(result);

      const bal = await storage.getBalance('alice', asset.assetId);
      expect(bal.balance).toBe('1000');
      expect(bal.held).toBe('400');
      expect(bal.available).toBe('600');
    });

    test('release unlocks and moves to destination', async () => {
      const operationId = 'op-2';
      await service.hold(
        nextIk(), 'nonce', aliceSource, bobDest, asset, '300',
        dummySig, operationId, undefined,
      );

      const result = await service.release(
        nextIk(), aliceSource, bobDest, asset, '300', operationId, undefined,
      );

      expectSuccess(result);
      expect(payoutCalls).toHaveLength(0);

      const aliceBal = await storage.getBalance('alice', asset.assetId);
      const bobBal = await storage.getBalance('bob', asset.assetId);
      expect(aliceBal.balance).toBe('700');
      expect(aliceBal.held).toBe('0');
      expect(bobBal.balance).toBe('300');
    });

    test('rollback unlocks funds back to available', async () => {
      const operationId = 'op-3';
      await service.hold(
        nextIk(), 'nonce', aliceSource, bobDest, asset, '500',
        dummySig, operationId, undefined,
      );

      const result = await service.rollback(
        nextIk(), aliceSource, asset, '500', operationId, undefined,
      );

      expectSuccess(result);

      const bal = await storage.getBalance('alice', asset.assetId);
      expect(bal.balance).toBe('1000');
      expect(bal.held).toBe('0');
      expect(bal.available).toBe('1000');
    });

    test('hold + partial release + rollback remainder', async () => {
      const opHold = 'op-4';
      await service.hold(
        nextIk(), 'nonce', aliceSource, bobDest, asset, '600',
        dummySig, opHold, undefined,
      );

      await service.release(
        nextIk(), aliceSource, bobDest, asset, '200', opHold, undefined,
      );

      const midBal = await storage.getBalance('alice', asset.assetId);
      expect(midBal.balance).toBe('800');
      expect(midBal.held).toBe('400');

      await service.rollback(
        nextIk(), aliceSource, asset, '400', opHold, undefined,
      );

      const finalBal = await storage.getBalance('alice', asset.assetId);
      expect(finalBal.balance).toBe('800');
      expect(finalBal.held).toBe('0');
      expect(finalBal.available).toBe('800');

      const bobBal = await storage.getBalance('bob', asset.assetId);
      expect(bobBal.balance).toBe('200');
    });
  });

  // ─── escrow with delegate ─────────────────────────────────────────────

  describe('escrow with EscrowDelegate', () => {
    let escrowDelegateCalls: { method: string; operationId: string }[];
    let holdResult: DelegateResult;
    let releaseResult: DelegateResult;
    let rollbackResult: DelegateResult;
    let delegatedService: VanillaServiceImpl;

    const mockEscrowDelegate: EscrowDelegate = {
      async hold(_ik, _src, _dst, _asset, _qty, operationId, _exCtx) {
        escrowDelegateCalls.push({ method: 'hold', operationId });
        return holdResult;
      },
      async release(_ik, _src, _dst, _asset, _qty, operationId, _exCtx) {
        escrowDelegateCalls.push({ method: 'release', operationId });
        return releaseResult;
      },
      async rollback(_ik, _src, _asset, _qty, operationId, _exCtx) {
        escrowDelegateCalls.push({ method: 'rollback', operationId });
        return rollbackResult;
      },
    };

    beforeEach(async () => {
      escrowDelegateCalls = [];
      holdResult = { success: true, transactionId: 'ext-hold-1' };
      releaseResult = { success: true, transactionId: 'ext-release-1' };
      rollbackResult = { success: true, transactionId: 'ext-rollback-1' };

      delegatedService = new VanillaServiceImpl(storage, mockDelegate, undefined, mockEscrowDelegate);

      await storage.ensureAccount('alice', asset.assetId, asset.assetType);
      await storage.ensureAccount('bob', asset.assetId, asset.assetType);
      await storage.credit('alice', '1000', asset.assetId, { idempotency_key: nextIk() });
    });

    test('successful hold: locks locally and calls delegate', async () => {
      const result = await delegatedService.hold(
        nextIk(), 'nonce', aliceSource, bobDest, asset, '300',
        dummySig, 'op-d1', undefined,
      );

      expectSuccess(result);
      expect(escrowDelegateCalls).toEqual([{ method: 'hold', operationId: 'op-d1' }]);

      const bal = await storage.getBalance('alice', asset.assetId);
      expect(bal.held).toBe('300');
    });

    test('failed hold: locks then unlocks — balance restored', async () => {
      holdResult = { success: false, error: 'external escrow rejected' };

      const result = await delegatedService.hold(
        nextIk(), 'nonce', aliceSource, bobDest, asset, '400',
        dummySig, 'op-d2', undefined,
      );

      const failure = expectFailure(result);
      expect(failure.error.message).toBe('external escrow rejected');
      expect(escrowDelegateCalls).toEqual([{ method: 'hold', operationId: 'op-d2' }]);

      const bal = await storage.getBalance('alice', asset.assetId);
      expect(bal.balance).toBe('1000');
      expect(bal.held).toBe('0');
      expect(bal.available).toBe('1000');
    });

    test('successful release: calls delegate then unlockAndMove', async () => {
      await delegatedService.hold(
        nextIk(), 'nonce', aliceSource, bobDest, asset, '500',
        dummySig, 'op-d3', undefined,
      );

      const result = await delegatedService.release(
        nextIk(), aliceSource, bobDest, asset, '500', 'op-d3', undefined,
      );

      expectSuccess(result);
      expect(escrowDelegateCalls).toEqual([
        { method: 'hold', operationId: 'op-d3' },
        { method: 'release', operationId: 'op-d3' },
      ]);

      const aliceBal = await storage.getBalance('alice', asset.assetId);
      expect(aliceBal.balance).toBe('500');
      expect(aliceBal.held).toBe('0');
      const bobBal = await storage.getBalance('bob', asset.assetId);
      expect(bobBal.balance).toBe('500');
    });

    test('failed release: funds stay held', async () => {
      await delegatedService.hold(
        nextIk(), 'nonce', aliceSource, bobDest, asset, '200',
        dummySig, 'op-d4', undefined,
      );

      releaseResult = { success: false, error: 'external release failed' };
      const result = await delegatedService.release(
        nextIk(), aliceSource, bobDest, asset, '200', 'op-d4', undefined,
      );

      const failure = expectFailure(result);
      expect(failure.error.message).toBe('external release failed');

      const bal = await storage.getBalance('alice', asset.assetId);
      expect(bal.balance).toBe('1000');
      expect(bal.held).toBe('200');
      expect(bal.available).toBe('800');
    });
  });
});

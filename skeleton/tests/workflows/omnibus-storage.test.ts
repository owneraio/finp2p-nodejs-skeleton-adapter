import { Pool } from 'pg';
import { OmnibusStorage } from '../../src/services/omnibus/storage';
import * as workflows from '../../src/workflows';

describe('omnibus storage', () => {
  let container: { connectionString: string; storageUser: string; cleanup: () => Promise<void> };
  let pool: Pool;
  let storage: OmnibusStorage;
  let wfStorage: workflows.Storage;

  beforeEach(async () => {
    // @ts-ignore
    container = await global.startPostgresContainer();
    await workflows.migrateIfNeeded({
      connectionString: container.connectionString,
      // @ts-ignore
      gooseExecutablePath: await global.whichGoose(),
      migrationListTableName: 'finp2p_nodejs_skeleton_migrations',
      storageUser: container.storageUser,
    });
    pool = new Pool({ connectionString: container.connectionString });
    storage = new OmnibusStorage(pool);
    wfStorage = new workflows.Storage(container);
  });

  afterEach(async () => {
    await pool.end();
    await wfStorage.closeConnections();
    await container.cleanup();
  });

  const assetId = 'test-asset-1';
  const assetType = 'finp2p';
  let idempotencyCounter = 0;
  const nextDetails = () => ({
    idempotency_key: `ik-${Date.now()}-${++idempotencyCounter}`,
  });

  test('credit increases balance', async () => {
    await storage.ensureAccount('alice', assetId, assetType);
    await storage.credit('alice', '100', assetId, nextDetails());

    const bal = await storage.getBalance('alice', assetId);
    expect(bal.balance).toBe('100');
    expect(bal.held).toBe('0');
    expect(bal.available).toBe('100');
  });

  test('debit decreases balance', async () => {
    await storage.ensureAccount('alice', assetId, assetType);
    await storage.credit('alice', '100', assetId, nextDetails());
    await storage.debit('alice', '50', assetId, nextDetails());

    const bal = await storage.getBalance('alice', assetId);
    expect(bal.balance).toBe('50');
  });

  test('debit below zero throws BusinessError', async () => {
    await storage.ensureAccount('alice', assetId, assetType);
    await storage.credit('alice', '10', assetId, nextDetails());

    await expect(storage.debit('alice', '20', assetId, nextDetails()))
      .rejects.toThrow(/Insufficient balance/);
  });

  test('lock increases held', async () => {
    await storage.ensureAccount('alice', assetId, assetType);
    await storage.credit('alice', '100', assetId, nextDetails());
    await storage.lock('alice', '30', assetId, nextDetails());

    const bal = await storage.getBalance('alice', assetId);
    expect(bal.balance).toBe('100');
    expect(bal.held).toBe('30');
    expect(bal.available).toBe('70');
  });

  test('lock more than available fails', async () => {
    await storage.ensureAccount('alice', assetId, assetType);
    await storage.credit('alice', '100', assetId, nextDetails());

    // held must be <= balance, so locking 101 should fail
    await expect(storage.lock('alice', '101', assetId, nextDetails()))
      .rejects.toThrow(/Insufficient balance/);
  });

  test('unlock decreases held', async () => {
    await storage.ensureAccount('alice', assetId, assetType);
    await storage.credit('alice', '100', assetId, nextDetails());
    await storage.lock('alice', '50', assetId, nextDetails());
    await storage.unlock('alice', '30', assetId, nextDetails());

    const bal = await storage.getBalance('alice', assetId);
    expect(bal.held).toBe('20');
    expect(bal.available).toBe('80');
  });

  test('move transfers between accounts atomically', async () => {
    await storage.ensureAccount('alice', assetId, assetType);
    await storage.ensureAccount('bob', assetId, assetType);
    await storage.credit('alice', '100', assetId, nextDetails());

    await storage.move('alice', 'bob', '40', assetId, nextDetails());

    const aliceBal = await storage.getBalance('alice', assetId);
    const bobBal = await storage.getBalance('bob', assetId);
    expect(aliceBal.balance).toBe('60');
    expect(bobBal.balance).toBe('40');
  });

  test('unlockAndMove releases held and transfers', async () => {
    await storage.ensureAccount('alice', assetId, assetType);
    await storage.ensureAccount('bob', assetId, assetType);
    await storage.credit('alice', '100', assetId, nextDetails());
    await storage.lock('alice', '50', assetId, nextDetails());

    await storage.unlockAndMove('alice', 'bob', '50', assetId, nextDetails());

    const aliceBal = await storage.getBalance('alice', assetId);
    const bobBal = await storage.getBalance('bob', assetId);
    expect(aliceBal.balance).toBe('50');
    expect(aliceBal.held).toBe('0');
    expect(bobBal.balance).toBe('50');
  });

  test('unlockAndDebit releases held and debits', async () => {
    await storage.ensureAccount('alice', assetId, assetType);
    await storage.credit('alice', '100', assetId, nextDetails());
    await storage.lock('alice', '40', assetId, nextDetails());

    await storage.unlockAndDebit('alice', '40', assetId, nextDetails());

    const bal = await storage.getBalance('alice', assetId);
    expect(bal.balance).toBe('60');
    expect(bal.held).toBe('0');
  });

  test('idempotency: same key returns same transaction without side effects', async () => {
    await storage.ensureAccount('alice', assetId, assetType);
    await storage.credit('alice', '100', assetId, nextDetails());

    const details = nextDetails();
    const tx1 = await storage.debit('alice', '25', assetId, details);
    const tx2 = await storage.debit('alice', '25', assetId, details);

    // Same transaction returned
    expect(tx1.id).toBe(tx2.id);

    // Balance only debited once
    const bal = await storage.getBalance('alice', assetId);
    expect(bal.balance).toBe('75');
  });

  test('getTransaction retrieves by ID', async () => {
    await storage.ensureAccount('alice', assetId, assetType);
    const tx = await storage.credit('alice', '100', assetId, nextDetails());

    const found = await storage.getTransaction(tx.id);
    expect(found).toBeDefined();
    expect(found!.action).toBe('credit');
    expect(found!.amount).toBe('100');
  });

  test('findByOperationId retrieves by operation_id', async () => {
    await storage.ensureAccount('alice', assetId, assetType);
    const details = { ...nextDetails(), operation_id: 'op-123' };
    const tx = await storage.lock('alice', '0', assetId, details);

    const found = await storage.findByOperationId('op-123');
    expect(found).toBeDefined();
    expect(found!.id).toBe(tx.id);
  });

  test('getBalance returns zeros for nonexistent account', async () => {
    const bal = await storage.getBalance('nobody', assetId);
    expect(bal.balance).toBe('0');
    expect(bal.held).toBe('0');
    expect(bal.available).toBe('0');
  });

  test('ensureAccount is idempotent', async () => {
    await storage.ensureAccount('alice', assetId, assetType);
    await storage.ensureAccount('alice', assetId, assetType);
    // Should not throw
  });

  // --- Transaction field assertions (ported from Go Basic/Swaps tests) ---

  test('credit transaction has correct fields', async () => {
    await storage.ensureAccount('alice', assetId, assetType);
    const tx = await storage.credit('alice', '100', assetId, nextDetails());

    expect(tx.action).toBe('credit');
    expect(tx.source).toBeNull();
    expect(tx.destination).toBe('alice');
    expect(tx.amount).toBe('100');
    expect(tx.source_held).toBe('0');
    expect(tx.destination_held).toBe('0');
    expect(tx.asset_id).toBe(assetId);
    expect(tx.asset_type).toBe(assetType);
    expect(tx.created_at).toBeInstanceOf(Date);
  });

  test('lock transaction has correct fields', async () => {
    await storage.ensureAccount('alice', assetId, assetType);
    await storage.credit('alice', '100', assetId, nextDetails());
    const tx = await storage.lock('alice', '30', assetId, nextDetails());

    expect(tx.action).toBe('lock');
    expect(tx.source).toBe('alice');
    expect(tx.destination).toBeNull();
    expect(tx.amount).toBe('0');
    expect(tx.source_held).toBe('30');
  });

  test('debit transaction has correct fields', async () => {
    await storage.ensureAccount('alice', assetId, assetType);
    await storage.credit('alice', '100', assetId, nextDetails());
    const tx = await storage.debit('alice', '50', assetId, nextDetails());

    expect(tx.action).toBe('debit');
    expect(tx.source).toBe('alice');
    expect(tx.destination).toBeNull();
    expect(tx.amount).toBe('50');
    expect(tx.source_held).toBe('0');
  });

  test('unlock transaction has correct fields', async () => {
    await storage.ensureAccount('alice', assetId, assetType);
    await storage.credit('alice', '100', assetId, nextDetails());
    await storage.lock('alice', '40', assetId, nextDetails());
    const tx = await storage.unlock('alice', '20', assetId, nextDetails());

    expect(tx.action).toBe('unlock');
    expect(tx.source).toBe('alice');
    expect(tx.destination).toBeNull();
    expect(tx.amount).toBe('0');
    expect(tx.source_held).toBe('-20');
  });

  test('move transaction has correct fields', async () => {
    await storage.ensureAccount('alice', assetId, assetType);
    await storage.ensureAccount('bob', assetId, assetType);
    await storage.credit('alice', '100', assetId, nextDetails());
    const tx = await storage.move('alice', 'bob', '40', assetId, nextDetails());

    expect(tx.action).toBe('move');
    expect(tx.source).toBe('alice');
    expect(tx.destination).toBe('bob');
    expect(tx.amount).toBe('40');
    expect(tx.source_held).toBe('0');
    expect(tx.destination_held).toBe('0');
  });

  // --- Debit violating held constraint (Go Basic test pattern) ---

  test('debit fails when it would make balance < held', async () => {
    await storage.ensureAccount('alice', assetId, assetType);
    await storage.credit('alice', '100', assetId, nextDetails());
    await storage.lock('alice', '20', assetId, nextDetails());

    // balance=100, held=20: debit 100 would leave balance=0 < held=20
    await expect(storage.debit('alice', '100', assetId, nextDetails()))
      .rejects.toThrow(/Insufficient balance/);

    // But debit 80 should succeed (balance=20 >= held=20)
    await storage.debit('alice', '80', assetId, nextDetails());
    const bal = await storage.getBalance('alice', assetId);
    expect(bal.balance).toBe('20');
    expect(bal.held).toBe('20');
    expect(bal.available).toBe('0');
  });

  // --- Unlock more than held (Go Basic test pattern) ---

  test('unlock more than held fails', async () => {
    await storage.ensureAccount('alice', assetId, assetType);
    await storage.credit('alice', '100', assetId, nextDetails());
    await storage.lock('alice', '20', assetId, nextDetails());

    await expect(storage.unlock('alice', '30', assetId, nextDetails()))
      .rejects.toThrow(/Insufficient balance/);
  });

  // --- Operations on nonexistent accounts (Go BalanceExceeded tests) ---

  test('lock on nonexistent account fails', async () => {
    await expect(storage.lock('nobody', '10', assetId, nextDetails()))
      .rejects.toThrow(/account not found/);
  });

  test('debit on nonexistent account fails', async () => {
    await expect(storage.debit('nobody', '10', assetId, nextDetails()))
      .rejects.toThrow(/account not found/);
  });

  test('move from nonexistent account fails', async () => {
    await storage.ensureAccount('bob', assetId, assetType);
    await expect(storage.move('nobody', 'bob', '10', assetId, nextDetails()))
      .rejects.toThrow(/account not found/);
  });

  test('unlockAndDebit on nonexistent account fails', async () => {
    await expect(storage.unlockAndDebit('nobody', '10', assetId, nextDetails()))
      .rejects.toThrow(/account not found/);
  });

  test('unlockAndMove from nonexistent account fails', async () => {
    await storage.ensureAccount('bob', assetId, assetType);
    await expect(storage.unlockAndMove('nobody', 'bob', '10', assetId, nextDetails()))
      .rejects.toThrow(/account not found/);
  });

  // --- Same-account self-transfer (Go SameAccountMovements test) ---

  test('move to same account fails', async () => {
    await storage.ensureAccount('alice', assetId, assetType);
    await storage.credit('alice', '100', assetId, nextDetails());

    await expect(storage.move('alice', 'alice', '10', assetId, nextDetails()))
      .rejects.toThrow(/Cannot move from account to itself/);
  });

  test('unlockAndMove to same account fails', async () => {
    await storage.ensureAccount('alice', assetId, assetType);
    await storage.credit('alice', '100', assetId, nextDetails());
    await storage.lock('alice', '50', assetId, nextDetails());

    await expect(storage.unlockAndMove('alice', 'alice', '50', assetId, nextDetails()))
      .rejects.toThrow(/Cannot move from account to itself/);
  });

  // --- Multi-step swap scenario (Go Swaps test) ---

  test('multi-step DvP swap across two accounts', async () => {
    await storage.ensureAccount('alice', assetId, assetType);
    await storage.ensureAccount('bob', assetId, assetType);

    // Alice gets 100, Bob gets 80
    await storage.credit('alice', '100', assetId, nextDetails());
    await storage.credit('bob', '80', assetId, nextDetails());

    // Both lock for a DvP
    await storage.lock('alice', '40', assetId, nextDetails());
    await storage.lock('bob', '30', assetId, nextDetails());

    // Alice sends 40 to Bob (move, not from held)
    await storage.move('alice', 'bob', '40', assetId, nextDetails());

    let aliceBal = await storage.getBalance('alice', assetId);
    let bobBal = await storage.getBalance('bob', assetId);
    expect(aliceBal.balance).toBe('60');
    expect(aliceBal.held).toBe('40');
    expect(bobBal.balance).toBe('120');
    expect(bobBal.held).toBe('30');

    // Both unlock
    await storage.unlock('alice', '40', assetId, nextDetails());
    await storage.unlock('bob', '30', assetId, nextDetails());

    aliceBal = await storage.getBalance('alice', assetId);
    bobBal = await storage.getBalance('bob', assetId);
    expect(aliceBal.balance).toBe('60');
    expect(aliceBal.held).toBe('0');
    expect(aliceBal.available).toBe('60');
    expect(bobBal.balance).toBe('120');
    expect(bobBal.held).toBe('0');
    expect(bobBal.available).toBe('120');
  });

  // --- Balance exceeded for all two-party operations (Go BalanceExceeded) ---

  test('move exceeding balance fails', async () => {
    await storage.ensureAccount('alice', assetId, assetType);
    await storage.ensureAccount('bob', assetId, assetType);
    await storage.credit('alice', '10', assetId, nextDetails());

    await expect(storage.move('alice', 'bob', '20', assetId, nextDetails()))
      .rejects.toThrow(/Insufficient balance/);
  });

  test('unlockAndDebit exceeding balance fails', async () => {
    await storage.ensureAccount('alice', assetId, assetType);
    await storage.credit('alice', '10', assetId, nextDetails());

    await expect(storage.unlockAndDebit('alice', '20', assetId, nextDetails()))
      .rejects.toThrow(/Insufficient balance/);
  });

  test('unlockAndMove exceeding balance fails', async () => {
    await storage.ensureAccount('alice', assetId, assetType);
    await storage.ensureAccount('bob', assetId, assetType);
    await storage.credit('alice', '10', assetId, nextDetails());

    await expect(storage.unlockAndMove('alice', 'bob', '20', assetId, nextDetails()))
      .rejects.toThrow(/Insufficient balance/);
  });

  test('high precision amounts are preserved', async () => {
    await storage.ensureAccount('alice', assetId, assetType);
    const bigAmount = '123456789012345678.123456789012345678';
    await storage.credit('alice', bigAmount, assetId, nextDetails());

    const bal = await storage.getBalance('alice', assetId);
    expect(bal.balance).toBe(bigAmount);
  });
});

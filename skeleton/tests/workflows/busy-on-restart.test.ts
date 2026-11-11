import { setTimeout as setTimeoutPromise } from 'node:timers/promises';
import { Pool } from 'pg';
import { FinP2PClient } from '@owneraio/finp2p-client';
import { createServiceProxy, migrateIfNeeded, WorkflowStorage } from '../../src/workflows';
import { PgStepExecutors } from '../../src/storage';
import { successfulReceiptOperation } from '../../src/models';
import { MockFinP2PServer } from '../support/mock-finp2p-server';

/**
 * A restart is instantaneous, so the dead process's claim is always fresh —
 * every crash recovery lands inside the takeover window on its first replay.
 *
 * `step()` reports that as StepBusy, and `executeAndFinalize` finalizes any
 * thrown error as a failure. Left alone that marks the operation **failed**
 * while its effect is live: the order is sitting at the issuer and the router
 * is told the issuance did not happen. Busy has to be waited out, not failed.
 */

let mockServer: MockFinP2PServer;
let finP2PClient: FinP2PClient;

beforeAll(async () => {
  mockServer = new MockFinP2PServer();
  const url = await mockServer.start();
  finP2PClient = new FinP2PClient(url, url);
});

afterAll(async () => {
  await mockServer.stop();
});

describe('restart inside the takeover window', () => {
  let container: { connectionString: string, storageUser: string, cleanup: () => Promise<void> } =
    { connectionString: '', storageUser: '', cleanup: () => Promise.resolve() };
  let pool: Pool;
  let storage: WorkflowStorage;
  let executors: PgStepExecutors;

  const KEY = 'idem-key-1';
  const TAKEOVER_MS = 1_000;

  beforeEach(async () => {
    // @ts-ignore
    container = await global.startPostgresContainer();
    await migrateIfNeeded({
      connectionString: container.connectionString,
      // @ts-ignore
      gooseExecutablePath: await global.whichGoose(),
      migrationListTableName: 'finp2p_nodejs_skeleton_migrations',
      storageUser: container.storageUser,
      schemaName: 'ledger_adapter',
    });
    pool = new Pool({ connectionString: container.connectionString });
    storage = new WorkflowStorage(pool, 'ledger_adapter');
    executors = new PgStepExecutors(pool, 'ledger_adapter');
  });

  afterEach(async () => {
    await pool.end();
    await container.cleanup();
  });

  const receipt = (id: string) => ({
    id, asset: { assetId: 'fund-x', assetType: 'finp2p' as const }, quantity: '5',
    timestamp: Date.now(), transactionDetails: {}, tradeDetails: { executionContext: undefined },
    operationType: 'issue',
  } as any);

  test('waits the claim out and completes, rather than failing the operation', async () => {
    const posts: string[] = [];

    const issue = (hang: boolean) => async (key: string) => {
      const steps = executors.forScope('wisdomtree');
      return steps.step({ id: key, method: 'issue' }, 'place-order', { qty: '5' }, async (ctx) => {
        // Reconcile rather than repeat, exactly as the plugin would.
        if (ctx.priorAttempt) {
          return { orderReference: posts[0] };
        }
        posts.push(`ord-${posts.length + 1}`);
        if (hang) {
          await new Promise<never>(() => {});
        }
        return { orderReference: posts[posts.length - 1] };
      }, { takeoverAfterMs: TAKEOVER_MS });
    };

    const adapter = (hang: boolean) => createServiceProxy(
      () => Promise.resolve(), storage, finP2PClient,
      {
        async issue(...args: any[]) {
          await issue(hang)(args[0]);
          return successfulReceiptOperation(receipt(args[0]));
        },
        async operationStatus(_cid: string): Promise<any> {},
      },
      'issue',
    );

    const pending = await adapter(true).issue(KEY);
    const cid = (pending as any).correlationId;
    while (posts.length === 0) {
      await setTimeoutPromise(20);
    }

    // --- restart at once, well inside the takeover window ---
    adapter(false);

    const deadline = Date.now() + 20_000;
    let status = 'in_progress';
    while (Date.now() < deadline && status !== 'succeeded') {
      await setTimeoutPromise(100);
      status = (await storage.getOperationByCid(cid))!.status;
      // The operation must never be finalized as failed while it is merely
      // waiting for a dead process's claim to age out.
      expect(status).not.toBe('failed');
    }

    expect(status).toBe('succeeded');
    expect(posts).toHaveLength(1);
  }, 60_000);
});

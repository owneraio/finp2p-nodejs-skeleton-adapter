import { setTimeout as setTimeoutPromise } from 'node:timers/promises';
import { Pool } from 'pg';
import { FinP2PClient } from '@owneraio/finp2p-client';
import { createServiceProxy, migrateIfNeeded, WorkflowStorage } from '../../src/workflows';
import { successfulReceiptOperation } from '../../src/models';
import { PgStepExecutors } from '../../src/storage';
import { StepExecutor } from '../../src/models';
import { MockFinP2PServer } from '../support/mock-finp2p-server';

/**
 * The failure this guards against, as seen on a WisdomTree-style issuance:
 * `issue` places a Purchase order and then waits hours for the mint cutoff.
 * `createServiceProxy` replays an unfinished operation **from the top of the
 * method**, so an adapter restarted mid-wait re-enters `issue` and places the
 * order a second time.
 *
 * A restart here is the real thing, not a mock: the first proxy is abandoned
 * and a second is built over the same database, which is what replay keys off.
 */

/** Stands in for WisdomTree Connect, counting what actually reached it. */
class FakeConnect {
  readonly posts: Array<{ request: string; idempotencyKey: string }> = [];

  private readonly orders = new Map<string, { request: string; minted: boolean }>();

  constructor(private readonly honoursIdempotencyKey: boolean,
    private readonly settleAfterMs = 150) {}

  /** Returns an order reference. With idempotency honoured, a repeat of the
   *  same key returns the first order instead of opening a second. */
  async placeOrder(request: string, idempotencyKey: string): Promise<string> {
    if (this.honoursIdempotencyKey) {
      const existing = [...this.orders.entries()].find(([ref]) => ref === `ord-${idempotencyKey.slice(0, 8)}`);
      if (existing) {
        return existing[0];
      }
    }
    this.posts.push({ request, idempotencyKey });
    const ref = this.honoursIdempotencyKey
      ? `ord-${idempotencyKey.slice(0, 8)}`
      : `ord-${this.posts.length}`;
    this.orders.set(ref, { request, minted: false });
    // Mints on its own after the cutoff, so no test has to choreograph it.
    setTimeout(() => this.settle(ref), this.settleAfterMs).unref();
    return ref;
  }

  /** The reconcile path: find an order already placed for this request. */
  async findOrder(request: string): Promise<string | undefined> {
    const found = [...this.orders.entries()].filter(([, o]) => o.request === request);
    return found.length === 1 ? found[0][0] : undefined;
  }

  settle(reference: string): void {
    const order = this.orders.get(reference);
    if (order) order.minted = true;
  }

  async getOrder(reference: string): Promise<{ minted: boolean }> {
    return { minted: this.orders.get(reference)?.minted ?? false };
  }

  get orderCount(): number {
    return this.orders.size;
  }
}

/**
 * A plugin shaped like the WisdomTree one: place an order, then wait for the
 * mint. `behaviour` lets a test interrupt it at a chosen point.
 */
const issuance = (
  steps: StepExecutor, connect: FakeConnect,
  behaviour: { afterPost?: () => Promise<never> } = {},
) => async (idempotencyKey: string, request: string) => {
  const { orderReference } = await steps.step(idempotencyKey, 'place-order', request,
    async (ctx) => {
      // An earlier attempt started and never recorded an outcome, so the order
      // may already exist. Adopt it rather than open a second one. With an
      // issuer that honours ctx.token this branch is belt-and-braces; without
      // one it is the only thing standing between a restart and a double buy.
      if (ctx.priorAttempt) {
        const adopted = await connect.findOrder(request);
        if (adopted) {
          return { orderReference: adopted };
        }
      }
      const ref = await connect.placeOrder(request, ctx.token);
      if (behaviour.afterPost) {
        await behaviour.afterPost();
      }
      return { orderReference: ref };
    }, { takeoverAfterMs: 100 });

  // Polling is read-only, so concurrent runs are harmless and exclusion is off.
  return steps.step(idempotencyKey, 'await-mint', request, async () => {
    for (let i = 0; i < 200; i++) {
      if ((await connect.getOrder(orderReference)).minted) {
        return { orderReference, minted: true };
      }
      await setTimeoutPromise(25);
    }
    throw new Error('mint did not settle');
  }, { takeoverAfterMs: 0 });
};

const waitForStatus = async (storage: WorkflowStorage, cid: string, target: string, timeoutMs = 15_000) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const op = await storage.getOperationByCid(cid);
    if (op && op.status === target) return op;
    await setTimeoutPromise(100);
  }
  throw new Error(`Operation ${cid} did not reach '${target}' within ${timeoutMs}ms`);
};

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

describe('restart does not re-execute a placed order', () => {
  let container: { connectionString: string, storageUser: string, cleanup: () => Promise<void> } =
    { connectionString: '', storageUser: '', cleanup: () => Promise.resolve() };
  let pool: Pool;
  let storage: WorkflowStorage;
  let executors: PgStepExecutors;

  const KEY = 'idem-key-1';
  const REQUEST = 'buy 5 of fund-x';

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

  /** A fresh executor per process — a restart does not inherit the in-process
   *  join map, which is exactly what makes the durable claim do the work. */
  const processSteps = () => executors.forScope('wisdomtree');

  const adapter = (issue: (k: string, r: string) => Promise<unknown>) => createServiceProxy(
    () => Promise.resolve(), storage, finP2PClient,
    {
      async issue(...args: any[]) {
        await issue(args[0], args[1]);
        return successfulReceiptOperation(receipt(args[0]));
      },
      async operationStatus(_cid: string): Promise<any> {},
    },
    'issue',
  );

  // 1. Down before the order ever went out. Replay must place it — once.
  test('crash before the order is placed: placed exactly once on restart', async () => {
    const connect = new FakeConnect(false);

    const pending = await adapter(() => new Promise<never>(() => {})).issue(KEY, REQUEST);
    const cid = (pending as any).correlationId;
    expect(connect.posts).toHaveLength(0);

    // --- restart: first proxy abandoned, second replays from the top ---
    adapter(issuance(processSteps(), connect));
    await waitForStatus(storage, cid, 'succeeded');

    expect(connect.posts).toHaveLength(1);
    expect(connect.orderCount).toBe(1);
  });

  // 2. Down after the order was placed AND recorded. Replay must skip the POST
  //    entirely and resume waiting on the order it already has.
  test('crash after the order is recorded: not placed again on restart', async () => {
    const connect = new FakeConnect(false);

    // First run gets as far as recording place-order, then hangs in the wait.
    const first = adapter(issuance(processSteps(), connect));
    const pending = await first.issue(KEY, REQUEST);
    const cid = (pending as any).correlationId;
    await waitFor(async () => (await processSteps().stored(KEY, 'place-order')) !== undefined);
    expect(connect.posts).toHaveLength(1);

    // --- restart ---
    adapter(issuance(processSteps(), connect));
    await waitForStatus(storage, cid, 'succeeded');

    // The POST count is the assertion that matters.
    expect(connect.posts).toHaveLength(1);
    expect(connect.orderCount).toBe(1);
  });

  // 3. The window eth-tools hit: the POST reached Connect, the process died
  //    before the outcome was recorded. Replay sees priorAttempt and reconciles.
  test('crash between the POST and recording it: adopted, not re-placed', async () => {
    const connect = new FakeConnect(false);

    // Posts, then never returns — the process is gone at that instant.
    const first = adapter(issuance(processSteps(), connect, { afterPost: () => new Promise<never>(() => {}) }));
    const pending = await first.issue(KEY, REQUEST);
    const cid = (pending as any).correlationId;
    await waitFor(async () => connect.posts.length === 1);
    expect(await processSteps().stored(KEY, 'place-order')).toBeUndefined();

    // The dead process's claim goes stale, then the restart takes it over.
    await setTimeoutPromise(150);
    adapter(issuance(processSteps(), connect));
    await waitForStatus(storage, cid, 'succeeded');

    expect(connect.posts).toHaveLength(1);
    expect(connect.orderCount).toBe(1);
  });

  // The same window, but the issuer honours ctx.token. Re-posting is then safe
  // and the reconcile lookup stops being load-bearing.
  test('crash in the window with issuer idempotency: still one order', async () => {
    const connect = new FakeConnect(true);

    const first = adapter(issuance(processSteps(), connect, { afterPost: () => new Promise<never>(() => {}) }));
    const pending = await first.issue(KEY, REQUEST);
    const cid = (pending as any).correlationId;
    await waitFor(async () => connect.posts.length === 1);

    await setTimeoutPromise(150);
    adapter(issuance(processSteps(), connect));
    await waitForStatus(storage, cid, 'succeeded');

    expect(connect.orderCount).toBe(1);
  });

  // Without steps at all, the same restart places the order twice — the
  // behaviour this feature exists to prevent.
  test('without steps, the same restart double-places the order', async () => {
    const connect = new FakeConnect(false);

    const naive = (behaviour: { afterPost?: () => Promise<never> } = {}) =>
      async (_key: string, request: string) => {
        const ref = await connect.placeOrder(request, 'no-token');
        if (behaviour.afterPost) await behaviour.afterPost();
        return { orderReference: ref, minted: true };
      };

    const first = adapter(naive({ afterPost: () => new Promise<never>(() => {}) }));
    await first.issue(KEY, REQUEST);
    await waitFor(async () => connect.posts.length === 1);

    adapter(naive());
    await waitFor(async () => connect.posts.length === 2);

    expect(connect.posts).toHaveLength(2);
  });
});

const waitFor = async (predicate: () => Promise<boolean>, timeoutMs = 10_000) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await setTimeoutPromise(50);
  }
  throw new Error('condition not met in time');
};

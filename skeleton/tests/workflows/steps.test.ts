import { migrateIfNeeded } from '../../src/workflows'
import { PgStepExecutors, PgResourceClaims, stepToken } from '../../src/storage'
import { StepExecutor, isStepBusy, isStepRequestMismatch } from '../../src/models'
import { Pool } from 'pg'

describe('operation steps', () => {
  let container: { connectionString: string, storageUser: string, cleanup: () => Promise<void> } = { connectionString: "", storageUser: "", cleanup: () => Promise.resolve() }
  let pool: Pool;
  let executors: PgStepExecutors;
  let steps: StepExecutor;

  const OP = 'idem-key-1';

  beforeEach(async () => {
    // @ts-ignore
    container = await global.startPostgresContainer();
    await migrateIfNeeded({
      connectionString: container.connectionString,
      // @ts-ignore
      gooseExecutablePath: await global.whichGoose(),
      migrationListTableName: "finp2p_nodejs_skeleton_migrations",
      storageUser: container.storageUser,
      schemaName: "ledger_adapter",
    })
    pool = new Pool({ connectionString: container.connectionString });
    executors = new PgStepExecutors(pool, "ledger_adapter");
    steps = executors.forScope('wisdomtree');
  });

  afterEach(async () => {
    await pool.end();
    await container.cleanup();
  });

  test('runs the body once and reuses the outcome on replay', async () => {
    let calls = 0;
    const place = () => steps.step(OP, 'place-order', { qty: '5' }, async () => {
      calls++;
      return { orderReference: 'ord-1' };
    });

    expect(await place()).toEqual({ orderReference: 'ord-1' });
    expect(await place()).toEqual({ orderReference: 'ord-1' });
    expect(calls).toBe(1);
  });

  test('a later step reads an earlier step\'s stored value', async () => {
    await steps.step(OP, 'place-order', {}, async () => ({ orderReference: 'ord-7' }));

    const ref = await steps.stored<{ orderReference: string }>(OP, 'place-order');

    expect(ref?.orderReference).toBe('ord-7');
  });

  test('stored() is undefined for a step that never completed', async () => {
    expect(await steps.stored(OP, 'never-run')).toBeUndefined();
  });

  // A returned failure is a final outcome — a 4xx refusal must not be re-sent.
  test('a returned failure completes the step', async () => {
    let calls = 0;
    const run = () => steps.step(OP, 'place-order', {}, async () => {
      calls++;
      return { ok: false, reason: 'rejected' };
    });

    await run();
    expect(await run()).toEqual({ ok: false, reason: 'rejected' });
    expect(calls).toBe(1);
  });

  // A throw is an unknown outcome — nothing stored, and the next attempt is
  // told an earlier one happened so it can reconcile instead of repeating.
  test('a throw stores nothing and the retry sees priorAttempt', async () => {
    await expect(steps.step(OP, 'place-order', {}, async () => {
      throw new Error('connect timed out');
    })).rejects.toThrow('connect timed out');

    expect(await steps.stored(OP, 'place-order')).toBeUndefined();

    let seen: Date | undefined;
    const out = await steps.step(OP, 'place-order', {}, async (ctx) => {
      seen = ctx.priorAttempt?.startedAt;
      return { orderReference: 'adopted' };
    });

    expect(seen).toBeInstanceOf(Date);
    expect(out).toEqual({ orderReference: 'adopted' });
  });

  test('the same step name with different inputs is refused', async () => {
    await steps.step(OP, 'place-order', { qty: '5' }, async () => ({ orderReference: 'ord-1' }));

    const err = await steps
      .step(OP, 'place-order', { qty: '9' }, async () => ({ orderReference: 'ord-2' }))
      .catch(e => e);

    expect(isStepRequestMismatch(err)).toBe(true);
  });

  test('inputs fingerprint by value, not property order', async () => {
    await steps.step(OP, 'place-order', { a: 1, b: 2 }, async () => ({ orderReference: 'ord-1' }));

    const same = await steps.step(OP, 'place-order', { b: 2, a: 1 }, async () => ({ orderReference: 'ord-2' }));

    expect(same).toEqual({ orderReference: 'ord-1' });
  });

  test('a fresh attempt held elsewhere is busy, not re-run', async () => {
    // Another process's in-flight claim: start a body that never settles.
    const other = executors.forScope('wisdomtree');
    let release: () => void = () => {};
    let started: () => void = () => {};
    const bodyStarted = new Promise<void>(r => { started = r; });
    const held = other.step(OP, 'place-order', {}, () => new Promise<{ x: number }>(r => {
      release = () => r({ x: 1 });
      started();
    }));
    // Wait until the claim is actually held, else the contender may win the
    // race and the roles simply swap.
    await bodyStarted;

    // A different executor instance, so the in-process join does not apply.
    const contender = executors.forScope('wisdomtree');
    const err = await contender.step(OP, 'place-order', {}, async () => ({ x: 2 })).catch(e => e);

    expect(isStepBusy(err)).toBe(true);

    release();
    await held;
  });

  test('takeoverAfterMs 0 lets a read-only step run concurrently', async () => {
    const a = executors.forScope('wisdomtree');
    const b = executors.forScope('wisdomtree');
    let release: () => void = () => {};
    const held = a.step(OP, 'await-mint', {}, () => new Promise<{ x: number }>(r => {
      release = () => r({ x: 1 });
    }), { takeoverAfterMs: 0 });

    await expect(b.step(OP, 'await-mint', {}, async () => ({ x: 2 }), { takeoverAfterMs: 0 }))
      .resolves.toBeDefined();

    release();
    await held;
  });

  test('concurrent calls in one process share a single run', async () => {
    let calls = 0;
    const body = async () => {
      calls++;
      return { orderReference: 'ord-1' };
    };

    const [a, b] = await Promise.all([
      steps.step(OP, 'place-order', {}, body),
      steps.step(OP, 'place-order', {}, body),
    ]);

    expect(a).toEqual(b);
    expect(calls).toBe(1);
  });

  test('scopes are isolated', async () => {
    await steps.step(OP, 'place-order', {}, async () => ({ orderReference: 'wt' }));

    const other = executors.forScope('other-plugin');

    expect(await other.stored(OP, 'place-order')).toBeUndefined();
  });

  test('the token is stable and scope-dependent', () => {
    expect(stepToken('wisdomtree', OP, 'place-order'))
      .toBe(stepToken('wisdomtree', OP, 'place-order'));
    expect(stepToken('other', OP, 'place-order'))
      .not.toBe(stepToken('wisdomtree', OP, 'place-order'));
    // Renaming a step changes the remote idempotency key — a documented cost.
    expect(stepToken('wisdomtree', OP, 'place-order2'))
      .not.toBe(stepToken('wisdomtree', OP, 'place-order'));
  });

  describe('resource claims', () => {
    test('one resource settles exactly one operation', async () => {
      const claims = new PgResourceClaims(pool, 'ledger_adapter');

      expect(await claims.claim('burn', 'burn-1', 'op-a')).toBe('op-a');
      expect(await claims.claim('burn', 'burn-1', 'op-b')).toBe('op-a');
      expect(await claims.claim('burn', 'burn-2', 'op-b')).toBe('op-b');
    });
  });
});

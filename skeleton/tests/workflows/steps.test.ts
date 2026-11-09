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

  describe('concurrency', () => {
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

    const attemptOf = async (name: string): Promise<number | undefined> => {
      const { rows } = await pool.query(
        `SELECT attempt FROM ledger_adapter.operation_steps
         WHERE scope = 'wisdomtree' AND operation_id = $1 AND step_name = $2`, [OP, name]);
      return rows[0]?.attempt;
    };

    const until = async (p: () => Promise<boolean>, ms = 5_000) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        if (await p()) return;
        await sleep(20);
      }
      throw new Error('condition not met in time');
    };

    /**
     * Two callers racing the step's first insert: `ON CONFLICT` sees the other
     * transaction's committed row and matches nothing, while the fallback
     * `SELECT` reads an older snapshot and cannot see it either, so the
     * statement returns no row at all. Unretried that is a TypeError on
     * `rows[0]`, surfacing as a failed operation rather than contention.
     */
    test('a raced first acquisition never comes back empty', async () => {
      for (let i = 0; i < 20; i++) {
        const name = `place-order-${i}`;
        let bodies = 0;
        const racer = () => executors.forScope('wisdomtree')
          .step(OP, name, { qty: '5' }, async () => {
            bodies++;
            return { orderReference: `ord-${i}` };
          })
          .catch(e => e);

        const [a, b] = await Promise.all([racer(), racer()]);

        for (const r of [a, b]) {
          // Busy is a legitimate answer. A TypeError is the defect.
          if (r instanceof Error) {
            expect(isStepBusy(r)).toBe(true);
          } else {
            expect(r).toEqual({ orderReference: `ord-${i}` });
          }
        }
        expect(bodies).toBeLessThanOrEqual(1);
      }
    }, 60_000);

    /**
     * A superseded attempt must not free the claim it no longer holds: doing so
     * hands the step to a third runner while the real owner is still mid-flight,
     * which is exactly the double execution the exclusion exists to prevent.
     */
    test('an attempt that was taken over cannot release the new owner', async () => {
      const NAME = 'place-order';
      let failFirst: (e: Error) => void = () => {};
      const firstBody = new Promise<never>((_, reject) => { failFirst = reject; });

      // Runner A takes the step, then stalls.
      const a = executors.forScope('wisdomtree')
        .step(OP, NAME, {}, async () => firstBody, { takeoverAfterMs: 50 }).catch(e => e);
      await until(async () => (await attemptOf(NAME)) === 1);

      // Its claim goes stale and runner B takes over as attempt 2, then stalls.
      await sleep(80);
      executors.forScope('wisdomtree')
        .step(OP, NAME, {}, async () => new Promise<never>(() => {}), { takeoverAfterMs: 50 })
        .catch(() => {});
      await until(async () => (await attemptOf(NAME)) === 2);

      // Now A fails. Its release must not touch B's claim.
      failFirst(new Error('boom'));
      expect(await a).toBeInstanceOf(Error);

      // A third runner, honouring a long window, must still find B in flight.
      const c = await executors.forScope('wisdomtree')
        .step(OP, NAME, {}, async () => ({ shouldNotRun: true }), { takeoverAfterMs: 10_000 })
        .catch(e => e);

      expect(isStepBusy(c)).toBe(true);
    }, 30_000);

    /**
     * The mirror of the empty read, and why the classifying read cannot share
     * the upsert's statement: `ON CONFLICT` blocks on a row locked by an
     * uncommitted transaction, so by the time it re-reads, the step has
     * completed and it rightly declines to take it — while a `SELECT` beside it
     * still answers from the snapshot taken before that commit and reports
     * `running`, i.e. busy, discarding an outcome already in the table.
     *
     * The uncommitted UPDATE below is not artificial: it is exactly what the
     * completing runner's own transaction looks like from the acquirer's side.
     */
    test('a step completing mid-acquisition yields its outcome, not busy', async () => {
      const NAME = 'await-mint';
      let release: () => void = () => {};
      const held = executors.forScope('wisdomtree')
        .step(OP, NAME, {}, () => new Promise<{ minted: boolean }>(r => {
          release = () => r({ minted: false });
        }), { takeoverAfterMs: 0 });
      await until(async () => (await attemptOf(NAME)) === 1);

      // The holder completes but has not committed: the row is locked.
      const holder = new Pool({ connectionString: container.connectionString });
      const tx = await holder.connect();
      await tx.query('BEGIN');
      await tx.query(
        `UPDATE ledger_adapter.operation_steps
         SET state = 'completed', output = '{"minted":true}', attempt_started_at = NULL
         WHERE scope = 'wisdomtree' AND operation_id = $1 AND step_name = $2`, [OP, NAME]);

      // This blocks inside the upsert until the holder commits.
      let bodyRan = false;
      const acquirer = executors.forScope('wisdomtree')
        .step(OP, NAME, {}, async () => { bodyRan = true; return { minted: false }; },
          { takeoverAfterMs: 0 });

      await sleep(150);
      await tx.query('COMMIT');
      tx.release();

      await expect(acquirer).resolves.toEqual({ minted: true });
      expect(bodyRan).toBe(false);

      await holder.end();
      release();
      await held;
    }, 30_000);

    /** The in-process join must not answer a different question. */
    test('concurrent calls with different requests do not share a run', async () => {
      const settled = await Promise.allSettled([
        steps.step(OP, 'place-order', { qty: '5' }, async () => ({ r: 'five' })),
        steps.step(OP, 'place-order', { qty: '9' }, async () => ({ r: 'nine' })),
      ]);

      // Exactly one is answered; the other is told its inputs differ rather
      // than handed the first caller's outcome.
      expect(settled.filter(s => s.status === 'fulfilled')).toHaveLength(1);
      const rejected = settled.find(s => s.status === 'rejected') as PromiseRejectedResult;
      expect(isStepRequestMismatch(rejected.reason)).toBe(true);
    });
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

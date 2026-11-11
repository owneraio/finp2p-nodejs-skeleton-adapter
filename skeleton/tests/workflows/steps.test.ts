import { createHash } from 'crypto'
import { migrateIfNeeded } from '../../src/workflows'
import { PgStepExecutors, PgResourceClaims, stepToken, requestHash } from '../../src/storage'
import { StepExecutor, StepOperation, isStepBusy, isStepRequestMismatch } from '../../src/models'
import { Pool } from 'pg'

describe('operation steps', () => {
  let container: { connectionString: string, storageUser: string, cleanup: () => Promise<void> } = { connectionString: "", storageUser: "", cleanup: () => Promise.resolve() }
  let pool: Pool;
  let executors: PgStepExecutors;
  let steps: StepExecutor;

  const OP: StepOperation = { id: 'idem-key-1', method: 'issue' };

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

    let seen: number | undefined;
    const out = await steps.step(OP, 'place-order', {}, async (ctx) => {
      seen = ctx.priorAttempt?.startedAt;
      return { orderReference: 'adopted' };
    });

    // Epoch ms, not a Date: the SPI a plugin compiles against says number.
    expect(typeof seen).toBe('number');
    expect(seen).toBeGreaterThan(0);
    expect(out).toEqual({ orderReference: 'adopted' });
  });

  test('a released step is taken over at once, without waiting out the window', async () => {
    await steps.step(OP, 'place-order', {}, async () => { throw new Error('boom'); })
      .catch(() => undefined);

    // A long takeover window would hold off a *running* attempt; a released one
    // is 'open', so the next caller runs immediately.
    const out = await executors.forScope('wisdomtree')
      .step(OP, 'place-order', {}, async () => ({ orderReference: 'second' }),
        { takeoverAfterMs: 10 * 60_000 });

    expect(out).toEqual({ orderReference: 'second' });
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

  /**
   * The operation id is the caller's idempotency key and carries no method, so
   * `issue` and `redeem` can arrive under one key. Before `method` joined the
   * primary key, a step name shared between two methods was one step and the
   * second method read the first's outcome.
   */
  test('the same step name under two methods is two steps', async () => {
    const issue: StepOperation = { id: 'shared-key', method: 'issue' };
    const redeem: StepOperation = { id: 'shared-key', method: 'redeem' };
    let calls = 0;

    const first = await steps.step(issue, 'move-tokens', {}, async () => {
      calls++;
      return { tx: 'issue-tx' };
    });
    const second = await steps.step(redeem, 'move-tokens', {}, async () => {
      calls++;
      return { tx: 'redeem-tx' };
    });

    expect(first).toEqual({ tx: 'issue-tx' });
    expect(second).toEqual({ tx: 'redeem-tx' });
    expect(calls).toBe(2);
    expect(await steps.stored(issue, 'move-tokens')).toEqual({ tx: 'issue-tx' });
  });

  /**
   * The token goes to a remote API as its idempotency key and that API
   * remembers it for hours, so the derivation is pinned, not merely stable:
   * changing it would make the resend of an operation already in flight look
   * like a new one.
   */
  describe('the step token', () => {
    test('is the first 32 hex digits of sha256(method, id, name), as a UUID', () => {
      const h = createHash('sha256').update('issue\u0000idem-key-1\u0000place-order').digest('hex');
      expect(stepToken(OP, 'place-order'))
        .toBe(`${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`);
      expect(stepToken(OP, 'place-order'))
        .toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    test('varies with method, operation and name', () => {
      expect(stepToken({ id: OP.id, method: 'redeem' }, 'place-order'))
        .not.toBe(stepToken(OP, 'place-order'));
      expect(stepToken({ id: 'other', method: OP.method }, 'place-order'))
        .not.toBe(stepToken(OP, 'place-order'));
      // Renaming a step changes the remote idempotency key — a documented cost.
      expect(stepToken(OP, 'place-order2')).not.toBe(stepToken(OP, 'place-order'));
    });

    /** Scope is deliberately not an input: the host that derives the token on a
     *  retry is not always the one that first sent it. */
    test('does not depend on scope', () => {
      const a = executors.forScope('wisdomtree');
      const b = executors.forScope('other-plugin');
      expect(a).not.toBe(b);
      expect(stepToken(OP, 'place-order')).toBe(stepToken(OP, 'place-order'));
    });
  });

  /**
   * The canonical bytes are shared with the plugin host in
   * generic-custody-adapter (generic-custody-adapter#49). The same vectors are
   * pinned on both sides: if either drifts, one store would call a replayed
   * request a mismatch and fail the operation.
   */
  describe('canonical request bytes', () => {
    const sha = (s: string) => createHash('sha256').update(s).digest('hex');

    test('keys sort by code point; null members drop; array nulls stay', () => {
      expect(requestHash({ b: 1, B: { z: null, Y: 'y', a: 'a' }, a: [1, null] }))
        .toBe(sha('{"B":{"Y":"y","a":"a"},"a":[1,null],"b":1}'));
    });

    test('a string request is its JSON', () => {
      expect(requestHash('side|0xabc|0xdef|10')).toBe(sha('"side|0xabc|0xdef|10"'));
    });

    /**
     * The proxy replays arguments it stored as JSON, where an omitted optional
     * comes back as null, so absent and null have to fingerprint alike.
     */
    test('an absent member and a null member are the same request', () => {
      expect(requestHash({ a: 1, b: null })).toBe(requestHash({ a: 1 }));
      expect(requestHash({ a: 1, b: undefined })).toBe(requestHash({ a: 1 }));
    });

    /** An array is positional: dropping a hole would renumber everything after it. */
    test('a null array element is not dropped', () => {
      expect(requestHash([1, null, 3])).not.toBe(requestHash([1, 3]));
    });
  });

  describe('concurrency', () => {
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

    const attemptOf = async (name: string): Promise<number | undefined> => {
      const { rows } = await pool.query(
        `SELECT attempt FROM ledger_adapter.operation_steps
         WHERE scope = 'wisdomtree' AND method = $1 AND operation_id = $2 AND step_name = $3`,
        [OP.method, OP.id, name]);
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
     * Two callers racing the step's first insert. Acquisition must never come
     * back empty: a single upsert whose fallback `SELECT` sat in the same
     * statement returned no row at all here, because `ON CONFLICT` re-reads the
     * index while the `SELECT` beside it answers from the statement's older
     * snapshot. Unretried that is a TypeError on `rows[0]`, surfacing as a
     * failed operation rather than as contention.
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
     * The mirror of the empty read, and why acquisition is a loop of separate
     * statements. The take is a compare-and-set on `attempt`, which blocks on a
     * row locked by an uncommitted transaction; when that transaction commits
     * the step is `done`, so the CAS rightly matches nothing. The loop must
     * then go back and read the stored outcome rather than report busy from a
     * snapshot taken before the commit — which is how an outcome already in the
     * table got discarded.
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
         SET state = 'done', output = '{"minted":true}'
         WHERE scope = 'wisdomtree' AND method = $1 AND operation_id = $2 AND step_name = $3`,
        [OP.method, OP.id, NAME]);

      // This blocks inside the compare-and-set until the holder commits.
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
      const claims = new PgResourceClaims(pool, 'ledger_adapter').forScope('wisdomtree');

      expect(await claims.claim('burn', 'burn-1', 'op-a')).toBe('op-a');
      expect(await claims.claim('burn', 'burn-1', 'op-b')).toBe('op-a');
      expect(await claims.claim('burn', 'burn-2', 'op-b')).toBe('op-b');
    });

    test('scopes are isolated', async () => {
      const factory = new PgResourceClaims(pool, 'ledger_adapter');

      expect(await factory.forScope('wisdomtree').claim('burn', 'burn-1', 'op-a')).toBe('op-a');
      expect(await factory.forScope('other-plugin').claim('burn', 'burn-1', 'op-b')).toBe('op-b');
    });
  });
});

import { Pool } from 'pg'
import { migrateIfNeeded, durable } from '../../src/workflows'
import { PgStepExecutors, stepToken } from '../../src/storage'
import { StepExecutor } from '../../src/models'

describe('durable flows', () => {
  let container: { connectionString: string, storageUser: string, cleanup: () => Promise<void> } =
    { connectionString: '', storageUser: '', cleanup: () => Promise.resolve() }
  let pool: Pool
  let executors: PgStepExecutors
  let steps: StepExecutor

  const ID = 'idem-key-1'
  const REQUEST = 'buy|0xabc|0xdef|10'

  beforeEach(async () => {
    // @ts-ignore
    container = await global.startPostgresContainer()
    await migrateIfNeeded({
      connectionString: container.connectionString,
      // @ts-ignore
      gooseExecutablePath: await global.whichGoose(),
      migrationListTableName: 'finp2p_nodejs_skeleton_migrations',
      storageUser: container.storageUser,
      schemaName: 'ledger_adapter',
    })
    pool = new Pool({ connectionString: container.connectionString })
    executors = new PgStepExecutors(pool, 'ledger_adapter')
    steps = executors.forScope('wisdomtree')
  })

  afterEach(async () => {
    await pool.end()
    await container.cleanup()
  })

  /** A flow shaped like the WisdomTree one, with the effects counted. */
  const issuance = (effects: string[], behaviour: {
    failAt?: string
    stopAt?: string
    refuseAt?: string
    hangAt?: string
  } = {}) => {
    const act = async <T>(name: string, value: T): Promise<T> => {
      if (behaviour.hangAt === name) await new Promise<never>(() => {})
      if (behaviour.failAt === name) throw new Error(`${name} blew up`)
      effects.push(name)
      return value
    }
    return durable<{ qty: string }, { status: string; ref?: string }>('issue', (op) => {
      const order = op.block('resolve-order', { takeoverAfterMs: 0 }, async ({ input, refuse }) => {
        if (behaviour.refuseAt === 'resolve-order') refuse('no such asset in the router')
        return act('resolve-order', { qty: input.qty, venue: 'wt' })
      })
      const placed = op.block('place-order', async ({ get, token, priorAttempt, stop }) => {
        if (behaviour.stopAt === 'place-order') {
          stop({ status: 'failure', ref: 'refused-by-venue' })
        }
        const resolved = get(order)
        if (priorAttempt) {
          return act('place-order:adopted', { ref: `adopted-${resolved.qty}`, token })
        }
        return act('place-order', { ref: `ord-${resolved.qty}`, token })
      })
      return op.block('await-settlement', { takeoverAfterMs: 0 }, async ({ get }) =>
        act('await-settlement', { status: 'success', ref: get(placed).ref }))
    })
  }

  const run = (flow: ReturnType<typeof issuance>, on: StepExecutor = steps) =>
    flow.run(on, { id: ID, request: REQUEST, input: { qty: '5' } })

  test('runs each block once and replays without repeating any', async () => {
    const effects: string[] = []
    const flow = issuance(effects)

    const first = await run(flow)
    const second = await run(flow, executors.forScope('wisdomtree'))

    expect(first).toEqual({ status: 'completed', value: { status: 'success', ref: 'ord-5' } })
    expect(second).toEqual(first)
    expect(effects).toEqual(['resolve-order', 'place-order', 'await-settlement'])
  })

  test('a block reads an earlier block\'s output through its handle', async () => {
    const effects: string[] = []

    const outcome = await run(issuance(effects))

    // await-settlement returned get(placed).ref, which came from resolve-order's qty.
    expect(outcome).toMatchObject({ value: { ref: 'ord-5' } })
  })

  /**
   * The whole point: a restart re-enters `run` from the top, and the blocks
   * that completed return their rows instead of running again.
   */
  test('a crash mid-flow resumes at the failed block, with priorAttempt set', async () => {
    const first: string[] = []
    await expect(run(issuance(first, { failAt: 'place-order' })))
      .rejects.toThrow('place-order blew up')

    expect(first).toEqual(['resolve-order'])

    const second: string[] = []
    const outcome = await run(issuance(second), executors.forScope('wisdomtree'))

    // resolve-order is not repeated, and place-order is told an attempt came
    // before, so it reconciles rather than placing a second order.
    expect(second).toEqual(['place-order:adopted', 'await-settlement'])
    expect(outcome).toMatchObject({ status: 'completed', value: { ref: 'adopted-5' } })
  })

  test('the resumed run logs which block it resumed at', async () => {
    await expect(run(issuance([], { failAt: 'place-order' }))).rejects.toThrow()

    const lines: string[] = []
    const logger = { info: (m: string) => lines.push(m) }
    await issuance([]).run(executors.forScope('wisdomtree'),
      { id: ID, request: REQUEST, input: { qty: '5' }, tag: 'issue-1', logger })

    expect(lines).toContain('issue-1: resuming at place-order')
    // resolve-order was not run, so it is not reported as resumed-at.
    expect(lines).not.toContain('issue-1: resuming at resolve-order')
  })

  describe('stop', () => {
    test('ends the flow and the later block never runs', async () => {
      const effects: string[] = []

      const outcome = await run(issuance(effects, { stopAt: 'place-order' }))

      expect(outcome).toEqual({
        status: 'completed',
        stoppedAt: 'place-order',
        value: { status: 'failure', ref: 'refused-by-venue' },
      })
      expect(effects).toEqual(['resolve-order'])
    })

    /** The decision is recorded, so a replay ends the same way. */
    test('stays stopped on replay, without re-running the stopping block', async () => {
      await run(issuance([], { stopAt: 'place-order' }))

      // The second flow has no stop behaviour at all: if the decision were not
      // stored, place-order would run and the flow would carry on.
      const effects: string[] = []
      const outcome = await run(issuance(effects), executors.forScope('wisdomtree'))

      expect(outcome).toMatchObject({ stoppedAt: 'place-order', value: { status: 'failure' } })
      expect(effects).toEqual([])
    })
  })

  describe('refuse', () => {
    test('fails this call and records nothing, so a retry runs the block again', async () => {
      const outcome = await run(issuance([], { refuseAt: 'resolve-order' }))

      expect(outcome).toEqual({
        status: 'refused',
        block: 'resolve-order',
        reason: 'no such asset in the router',
      })

      // Nothing stored: the block is open, not done.
      const { rows } = await pool.query(
        `SELECT state FROM ledger_adapter.operation_steps
         WHERE operation_id = $1 AND step_name = 'resolve-order'`, [ID])
      expect(rows[0].state).toBe('open')

      // So fixing the cause and retrying runs it — this is why refuse exists.
      const effects: string[] = []
      const retried = await run(issuance(effects), executors.forScope('wisdomtree'))

      expect(effects).toEqual(['resolve-order', 'place-order', 'await-settlement'])
      expect(retried).toMatchObject({ status: 'completed' })
    })
  })

  describe('errors the runner maps once, in one place', () => {
    test('another process holding a block is reported busy, not failed', async () => {
      const held = run(issuance([], { hangAt: 'place-order' }), executors.forScope('wisdomtree'))
      await until(async () => (await stateOf('place-order')) === 'running')

      const outcome = await run(issuance([]), executors.forScope('wisdomtree'))

      expect(outcome).toMatchObject({ status: 'busy', block: 'place-order' })
      expect((outcome as { retryAfterMs: number }).retryAfterMs).toBeGreaterThan(0)
      void held
    }, 30_000)

    test('the same operation id under a different request is a mismatch', async () => {
      await run(issuance([]))

      const outcome = await issuance([]).run(executors.forScope('wisdomtree'),
        { id: ID, request: 'sell|0xabc|0xdef|10', input: { qty: '5' } })

      expect(outcome).toMatchObject({ status: 'mismatch', block: 'resolve-order' })
    })
  })

  /**
   * The compatibility guarantee in both directions: an ordinary block's row is
   * byte-for-byte what a direct `step()` call would have written. A release
   * using flows can be rolled back to one using `step()`, and anything reading
   * the rows another way — `stored()`, an operator's query — finds the fields
   * where they have always been.
   *
   * Only a `stop` is wrapped, because nothing in a value says it ended the
   * flow. A stop is terminal, so that is the whole of the incompatibility.
   */
  describe('what a block stores', () => {
    const outputOf = async (name: string): Promise<unknown> => {
      const { rows } = await pool.query(
        `SELECT output FROM ledger_adapter.operation_steps
         WHERE operation_id = $1 AND step_name = $2`, [ID, name])
      return rows[0]?.output
    }

    test('an ordinary block stores its value bare, with no wrapper', async () => {
      await run(issuance([]))

      const stored = await outputOf('resolve-order')

      expect(stored).toEqual({ qty: '5', venue: 'wt' })
      expect(stored).not.toHaveProperty('__durableBlock')
    })

    test('stored() reads a flow-written block directly, as an older release would', async () => {
      await run(issuance([]))

      // This is the read path of a release that predates the flow runner.
      const placed = await steps.stored<{ ref: string }>({ id: ID, method: 'issue' }, 'place-order')

      expect(placed?.ref).toBe('ord-5')
    })

    test('only a stop carries the marker', async () => {
      await run(issuance([], { stopAt: 'place-order' }))

      expect(await outputOf('resolve-order')).not.toHaveProperty('__durableBlock')
      expect(await outputOf('place-order')).toEqual({
        __durableBlock: 'stop',
        value: { status: 'failure', ref: 'refused-by-venue' },
      })
    })
  })

  /**
   * A deployment already using `step()` directly has rows holding the value
   * itself, not the runner's wrapper. Adopting a flow must read those, or
   * every in-flight operation would re-run its completed blocks.
   */
  test('reads a row written by a direct step() call, with no migration', async () => {
    const operation = { id: ID, method: 'issue' }
    await steps.step(operation, 'resolve-order', REQUEST, async () => ({ qty: '5', venue: 'wt' }))

    const effects: string[] = []
    const outcome = await run(issuance(effects), executors.forScope('wisdomtree'))

    expect(effects).toEqual(['place-order', 'await-settlement'])
    expect(outcome).toMatchObject({ status: 'completed', value: { ref: 'ord-5' } })
  })

  /**
   * A block's name is the step name, so it is also the token a remote API
   * keys on. A rename is a new step and a new token — the documented cost.
   */
  test('a block name is its step name, and the token follows from it', async () => {
    let seen = ''
    const flow = durable<void, string>('issue', (op) =>
      op.block('place-order', async ({ token }) => { seen = token; return 'ok' }))

    await flow.run(steps, { id: ID, request: REQUEST, input: undefined })

    expect(seen).toBe(stepToken({ id: ID, method: 'issue' }, 'place-order'))
    const { rows } = await pool.query(
      `SELECT step_name, method FROM ledger_adapter.operation_steps WHERE operation_id = $1`, [ID])
    expect(rows).toEqual([{ step_name: 'place-order', method: 'issue' }])
  })

  describe('declaration is checked when the flow is declared, not when it runs', () => {
    test('two blocks cannot share a name', () => {
      expect(() => durable<void, string>('issue', (op) => {
        op.block('place-order', async () => 'a')
        return op.block('place-order', async () => 'b')
      })).toThrow("duplicate block name 'place-order'")
    })

    test('a flow must declare at least one block', () => {
      expect(() => durable<void, string>('issue', () => ({ block: 0 })))
        .toThrow('declares no blocks')
    })

    test('a flow must return a handle it declared', () => {
      expect(() => durable<void, string>('issue', (op) => {
        op.block('place-order', async () => 'a')
        return { block: 7 }
      })).toThrow('must return the handle')
    })
  })

  test('a block cannot read a block that has not run yet', async () => {
    const flow = durable<void, string>('issue', (op) => {
      const later: { block: number } = { block: 1 }
      const first = op.block('first', async ({ get }) => get<string>(later))
      void first
      return op.block('second', async () => 'second')
    })

    await expect(flow.run(steps, { id: ID, request: REQUEST, input: undefined }))
      .rejects.toThrow('reads a block that has not run yet')
  })

  /**
   * A two-leg swap, with no plugin in sight — the shape `vanilla-service.swap`
   * has: move the asset leg, move the settlement leg, and revert the first if
   * the second fails.
   *
   * It also shows the cost of blocks being declared unconditionally. The
   * revert cannot be a block that exists only on the failure path, so the
   * settlement block *returns* whether it settled and a final block acts on
   * that. The decision is then recorded like any other outcome, which is what
   * makes the revert safe to resume into.
   */
  describe('a two-leg swap, without plugins', () => {
    const swap = (ledger: string[], settlementFails: boolean) =>
      durable<{ asset: string; settlement: string }, { status: string; reason?: string }>(
        'swap', (op) => {
          const assetLeg = op.block('move-asset-leg', async ({ input }) => {
            ledger.push(`move ${input.asset}`)
            return { tx: `tx-${input.asset}` }
          })
          const settlementLeg = op.block('move-settlement-leg', async ({ input }) => {
            if (settlementFails) {
              // A business refusal is a final outcome, so it is returned, not
              // thrown: throwing would leave the block open and retry it.
              return { settled: false as const, reason: 'insufficient settlement balance' }
            }
            ledger.push(`move ${input.settlement}`)
            return { settled: true as const, tx: `tx-${input.settlement}` }
          })
          return op.block('finish', async ({ get, stop }) => {
            const settled = get(settlementLeg)
            if (settled.settled) {
              return { status: 'success' }
            }
            ledger.push(`revert ${get(assetLeg).tx}`)
            return stop({ status: 'failure', reason: settled.reason })
          })
        })

    test('both legs move once, and a replay moves nothing', async () => {
      const ledger: string[] = []
      const input = { asset: 'ACME', settlement: 'USD' }
      const flow = swap(ledger, false)

      const first = await flow.run(steps, { id: 'swap-1', request: 'swap|ACME|USD', input })
      const again = await flow.run(executors.forScope('wisdomtree'),
        { id: 'swap-1', request: 'swap|ACME|USD', input })

      expect(first).toMatchObject({ status: 'completed', value: { status: 'success' } })
      expect(again).toEqual(first)
      expect(ledger).toEqual(['move ACME', 'move USD'])
    })

    test('a failed settlement leg reverts the first, exactly once', async () => {
      const ledger: string[] = []
      const input = { asset: 'ACME', settlement: 'USD' }

      const outcome = await swap(ledger, true)
        .run(steps, { id: 'swap-2', request: 'swap|ACME|USD', input })

      expect(outcome).toMatchObject({
        status: 'completed',
        stoppedAt: 'finish',
        value: { status: 'failure', reason: 'insufficient settlement balance' },
      })
      expect(ledger).toEqual(['move ACME', 'revert tx-ACME'])

      // A replay after the revert must not revert a second time.
      const replayed = await swap(ledger, true).run(executors.forScope('wisdomtree'),
        { id: 'swap-2', request: 'swap|ACME|USD', input })

      expect(replayed).toMatchObject({ value: { status: 'failure' } })
      expect(ledger).toHaveLength(2)
    })
  })

  const stateOf = async (name: string): Promise<string | undefined> => {
    const { rows } = await pool.query(
      `SELECT state FROM ledger_adapter.operation_steps
       WHERE operation_id = $1 AND step_name = $2`, [ID, name])
    return rows[0]?.state
  }

  const until = async (p: () => Promise<boolean>, ms = 5_000) => {
    const end = Date.now() + ms
    while (Date.now() < end) {
      if (await p()) return
      await new Promise(r => setTimeout(r, 20))
    }
    throw new Error('condition not met in time')
  }
})

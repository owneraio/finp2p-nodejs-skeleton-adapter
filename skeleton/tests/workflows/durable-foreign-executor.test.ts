import { durable } from '../../src/workflows'
import { StepContext, StepExecutor, StepOperation, StepOptions } from '../../src/models'

/**
 * A `StepExecutor` is documented as something a host implements, and both
 * known hosts take these interfaces *by shape* rather than importing the
 * classes — `isStepBusy` matches on `code`, not `instanceof`, precisely so a
 * consumer holding its own copy of the package still works.
 *
 * So the runner must not assume an error it classifies came from this
 * package's own `StepBusyError`. Generic-custody-adapter's executor really did
 * throw a `STEP_BUSY` error with no `retryAfterMs`, and the runner handed back
 * `undefined` behind a field `FlowOutcome` declares to be a number.
 */
describe('a foreign executor', () => {
  const flow = durable<void, string>('issue', (op) =>
    op.block('place-order', async () => 'ok'))

  const throwing = (error: unknown): StepExecutor => ({
    step<T>(_operation: StepOperation, _name: string, _request: unknown,
      _fn: (ctx: StepContext) => Promise<T>, _options?: StepOptions): Promise<T> {
      return Promise.reject(error)
    },
    stored<T>(): Promise<T | undefined> {
      return Promise.resolve(undefined)
    },
  })

  const run = (error: unknown) =>
    flow.run(throwing(error), { id: 'op-1', request: 'r', input: undefined })

  test('busy without retryAfterMs still reports a number', async () => {
    const outcome = await run(Object.assign(new Error('held elsewhere'), { code: 'STEP_BUSY' }))

    expect(outcome).toEqual({
      status: 'busy',
      block: 'place-order',
      retryAfterMs: 0,
      reason: 'held elsewhere',
    })
    expect(typeof (outcome as { retryAfterMs: number }).retryAfterMs).toBe('number')
  })

  test('busy with a retryAfterMs passes it through', async () => {
    const outcome = await run(
      Object.assign(new Error('held'), { code: 'STEP_BUSY', retryAfterMs: 1500 }))

    expect(outcome).toMatchObject({ status: 'busy', retryAfterMs: 1500 })
  })

  test('a non-numeric retryAfterMs does not leak NaN', async () => {
    const outcome = await run(
      Object.assign(new Error('held'), { code: 'STEP_BUSY', retryAfterMs: 'soon' }))

    expect(outcome).toMatchObject({ status: 'busy', retryAfterMs: 0 })
  })

  test('a mismatch is reported against the block, by code alone', async () => {
    const outcome = await run(
      Object.assign(new Error('other request'), { code: 'STEP_REQUEST_MISMATCH' }))

    expect(outcome).toEqual({
      status: 'mismatch',
      block: 'place-order',
      reason: 'other request',
    })
  })

  test('anything else propagates, rather than becoming an outcome', async () => {
    await expect(run(new Error('connection refused'))).rejects.toThrow('connection refused')
  })
})

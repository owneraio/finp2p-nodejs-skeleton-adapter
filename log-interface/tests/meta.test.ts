import { normalizeMeta } from '../src';

describe('normalizeMeta', () => {
  it('keeps name/message/stack, own fields and cause', () => {
    const cause = new Error('ECONNRESET');
    const error = Object.assign(new Error('rpc failed', { cause }), { code: 'SERVER_ERROR', status: 503 });
    expect(normalizeMeta({ error }).error).toEqual({
      name: 'Error',
      message: 'rpc failed',
      stack: error.stack,
      code: 'SERVER_ERROR',
      status: 503,
      cause: { name: 'Error', message: 'ECONNRESET', stack: cause.stack },
    });
  });

  it('reaches errors at any depth, so JSON keeps them', () => {
    const out = normalizeMeta({ ctx: { errors: [new Error('nested')] } });
    expect(JSON.parse(JSON.stringify(out))).toMatchObject({ ctx: { errors: [{ message: 'nested' }] } });
  });

  it('marks cycles, keeps shared references', () => {
    const shared = { v: 1 };
    const error = new Error('loop');
    error.cause = error;
    const meta: Record<string, unknown> = { a: shared, b: shared, error };
    meta.self = meta;
    expect(normalizeMeta(meta)).toMatchObject({
      a: { v: 1 }, b: { v: 1 }, self: '[circular]', error: { message: 'loop', cause: '[circular]' },
    });
  });

  it('leaves non-plain values alone', () => {
    class Box { v = 1; }
    const when = new Date(0);
    const box = new Box();
    const out = normalizeMeta({ when, box, n: 10n });
    expect(out.when).toBe(when);
    expect(out.box).toBe(box);
    expect(out.n).toBe(10n);
  });
});

import express from 'express';
import { AddressInfo } from 'node:net';
import { Server } from 'node:http';
import winston from 'winston';
import { registerConfigRoutes } from '../../src/config/routes';
import { ConfigRuntime } from '../../src/config/runtime';
import { ApplyResult, ConfigDescriptor, ERROR_CODES } from '../../src/config/types';
import {
  fakeHandler, NET, net, pages, RPC, SECRET, silentLogger, valid, validCustody,
} from './support/fixtures';
import { MemoryStore } from './support/memory-store';

const adapter = { id: 'test-adapter', kind: '@owneraio/test', version: '0.0.0' };

interface Res { status: number; body: any; text: string }

// @types/node 16 has no global fetch typing; node 18+ provides it at runtime
const { fetch } = globalThis as unknown as { fetch: (url: string, init: Record<string, unknown>) => Promise<{ status: number; text(): Promise<string> }> };

describe('config routes', () => {
  let server: Server;
  let base: string;
  let handler: ReturnType<typeof fakeHandler>;
  let store: MemoryStore;
  let runtime: ConfigRuntime;

  const call = async (method: string, path: string, body?: unknown, raw?: string): Promise<Res> => {
    const res = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', 'x-actor': 'me@test' },
      body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
    });
    const text = await res.text();
    let parsed: unknown;
    try { parsed = text ? JSON.parse(text) : undefined; } catch { parsed = undefined; }
    return { status: res.status, body: parsed, text };
  };

  beforeEach(async () => {
    handler = fakeHandler();
    store = new MemoryStore();
    runtime = new ConfigRuntime({ adapter, pages, handler, store, logger: silentLogger });
    const app = express();
    registerConfigRoutes(app, runtime, { jsonLimit: '10kb', logger: winston.createLogger({ silent: true }) });
    // a route outside /config must not get the config json parser or error handler
    app.post('/other', (req, res) => { res.json({ body: req.body ?? null }); });
    server = await new Promise<Server>((resolve) => { const s = app.listen(0, () => resolve(s)); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => { server.close((e) => (e ? reject(e) : resolve())); });
  });

  test('GET /config -> descriptor', async () => {
    const r = await call('GET', '/config');
    expect(r.status).toBe(200);
    const d = r.body as ConfigDescriptor;
    expect(d.protocol).toBe('adapter-config/2');
    expect(d.configs).toEqual([]);
    expect(d.readiness.ready).toBe(false);
    expect(d.pages.find((p) => p.id === 'custody')?.kind).toBe('custody');
  });

  test('POST /config/validate: 400 on bad shape / bad id, 200 result', async () => {
    expect((await call('POST', '/config/validate', { nope: 1 })).status).toBe(400);
    expect((await call('POST', '/config/validate', { values: [] })).status).toBe(400);
    const badKind = await call('POST', '/config/validate', { kind: 'asset', values: {} });
    expect(badKind).toMatchObject({ status: 400, body: { code: ERROR_CODES.badId } });
    expect((await call('POST', '/config/validate', { id: 'a b', values: {} })).status).toBe(400);
    const r = await call('POST', '/config/validate', { values: { RPC_URL: 'bad' } });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: false, errors: [expect.objectContaining({ path: 'RPC_URL' }), expect.objectContaining({ path: 'OPERATOR_KEY' })], checks: [] });
    const ok = await call('POST', '/config/validate', { values: valid });
    expect(ok.body).toMatchObject({ ok: true, errors: [] });
    const cust = await call('POST', '/config/validate', { kind: 'custody', values: validCustody });
    expect(cust.body).toMatchObject({ ok: true, errors: [] });
    expect(handler.activated).toHaveLength(0);
  });

  test('POST /config/apply: 200, then update, actor recorded, secret never echoed', async () => {
    const r = await call('POST', '/config/apply', { id: NET, name: 'Mainnet', values: { ...valid, RPC_AUTH: SECRET } });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, kind: 'network', id: NET, version: 1, state: 'configured' });
    expect(r.text).not.toContain(SECRET);
    expect(store.row(NET)?.actor).toBe('me@test');

    const d = (await call('GET', '/config')).body as ConfigDescriptor;
    expect(d.configs[0]).toMatchObject({ kind: 'network', id: NET, name: 'Mainnet', values: { RPC_URL: RPC, RPC_AUTH: { set: true } } });
    expect(JSON.stringify(d)).not.toContain(SECRET);

    const r2 = await call('POST', '/config/apply', { id: NET, values: { TAG: 'abc' } });
    expect(r2.body).toMatchObject({ ok: true, version: 2 });
    expect(handler.activated[1].secrets.RPC_AUTH).toBe(SECRET);

    const c = await call('POST', '/config/apply', { kind: 'custody', id: 'fb', values: validCustody });
    expect(c.body).toMatchObject({ ok: true, kind: 'custody', id: 'fb', version: 1 });
  });

  test('POST /config/apply: 400 without an id, 422 on validation and on failed check', async () => {
    const noId = await call('POST', '/config/apply', { values: valid });
    expect(noId).toMatchObject({ status: 400, body: { code: ERROR_CODES.badId } });
    expect(noId.body.error).toMatch(/CAIP-2/);

    const r = await call('POST', '/config/apply', { id: NET, values: { RPC_URL: 'bad', OPERATOR_KEY: SECRET } });
    expect(r.status).toBe(422);
    expect(r.body).toMatchObject({ ok: false, state: 'unconfigured' });
    expect(r.text).not.toContain(SECRET);

    handler.checksResult = [{ id: 'rpc', label: 'RPC', ok: false, message: `no route to ${SECRET}` }];
    const c = await call('POST', '/config/apply', { id: NET, values: { ...valid, RPC_AUTH: SECRET } });
    expect(c.status).toBe(422);
    expect((c.body as ApplyResult).checks[0].message).toBe('no route to [redacted]');
    expect(handler.activated).toHaveLength(0);
  });

  test('POST /config/apply: 500 build-failed, message redacted', async () => {
    handler.failActivate = new Error(`dial ${SECRET} refused`);
    const r = await call('POST', '/config/apply', { id: NET, values: { ...valid, RPC_AUTH: SECRET } });
    expect(r.status).toBe(500);
    expect(r.body).toMatchObject({ ok: false, state: 'error', version: 1, errors: [{ path: '', code: ERROR_CODES.buildFailed }] });
    expect(r.text).not.toContain(SECRET);
  });

  test('DELETE /config/:kind/:id: 400 bad kind, 404, 409 in-use, 204', async () => {
    expect((await call('DELETE', '/config/asset/x')).status).toBe(400);
    expect((await call('DELETE', `/config/network/${NET}`)).status).toBe(404);
    await call('POST', '/config/apply', { id: NET, values: valid });
    handler.used.add(NET);
    const inUse = await call('DELETE', `/config/network/${NET}`);
    expect(inUse.status).toBe(409);
    expect(inUse.body).toMatchObject({ code: ERROR_CODES.inUse });
    handler.used.delete(NET);
    expect((await call('DELETE', `/config/network/${NET}`)).status).toBe(204);
    expect(handler.deactivated).toEqual([net(NET)]);
    expect(((await call('GET', '/config')).body as ConfigDescriptor).configs).toEqual([]);
    // the old per-asset route is gone
    expect((await call('POST', `/config/${NET}/assets`, { assetId: 'x' })).status).toBe(404);
  });

  test('bad JSON -> 400, too large -> 413, json parser scoped to /config', async () => {
    const bad = await call('POST', '/config/apply', undefined, '{ not json');
    expect(bad).toMatchObject({ status: 400, body: { error: 'invalid JSON' } });
    const big = await call('POST', '/config/apply', { id: NET, values: { TAG: 'x'.repeat(20_000) } });
    expect(big.status).toBe(413);
    const other = await call('POST', '/other', { a: 1 });
    expect(other.body).toEqual({ body: null });
  });

  test('unexpected error -> 500 without the message', async () => {
    runtime.describe = async () => { throw new Error(`leak ${SECRET}`); };
    const r = await call('GET', '/config');
    expect(r).toMatchObject({ status: 500, body: { error: 'internal error' } });
    expect(r.text).not.toContain(SECRET);
  });
});

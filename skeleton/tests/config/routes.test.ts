import express from 'express';
import { AddressInfo } from 'node:net';
import { Server } from 'node:http';
import winston from 'winston';
import { registerConfigRoutes } from '../../src/config/routes';
import { ConfigRuntime } from '../../src/config/runtime';
import { MemoryConfigStore } from '../../src/config/store';
import { ERROR_CODES } from '../../src/config/types';
import {
  adapter, fakeHandler, KEY, NET, RPC, SECRET_KEYS, silentLogger, VERSION,
} from './support/fixtures';

interface Res { status: number; body: any; text: string }

// @types/node 16 has no global fetch typing; node 18+ provides it at runtime
const { fetch } = globalThis as unknown as { fetch: (url: string, init: Record<string, unknown>) => Promise<{ status: number; text(): Promise<string> }> };

describe('config routes', () => {
  let server: Server;
  let base: string;
  let handler: ReturnType<typeof fakeHandler>;
  let store: MemoryConfigStore;

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
    store = new MemoryConfigStore();
    const runtime = new ConfigRuntime({ version: VERSION, adapter, secretKeys: SECRET_KEYS, handler, store, logger: silentLogger });
    const app = express();
    registerConfigRoutes(app, runtime, { jsonLimit: '10kb', logger: winston.createLogger({ silent: true }) });
    // a route outside /config must not get the config json parser or error handler
    app.post('/other', (req, res) => { res.json({ body: req.body ?? null }); });
    await new Promise<void>((resolve) => { server = app.listen(0, resolve); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  test('GET /config: the version and no values before an apply', async () => {
    const r = await call('GET', '/config');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ protocol: 'adapter-config/3', version: VERSION, adapter, state: 'unconfigured', revision: 0, ledgers: {} });
  });

  test('POST /config applies, GET /config shows the values with the key masked', async () => {
    const post = await call('POST', '/config', { version: VERSION, ledgers: { [NET]: { rpcUrl: RPC, operatorKey: KEY } } });
    expect(post.status).toBe(200);
    expect(post.body).toEqual({ ok: true, applied: true, revision: 1, state: 'configured', errors: [] });
    expect(handler.applied[0].config.ledgers[NET].operatorKey).toBe(KEY);
    expect((await store.load())?.actor).toBe('me@test');

    const get = await call('GET', '/config');
    expect(get.body.ledgers).toEqual({ [NET]: { rpcUrl: RPC, operatorKey: { set: true } } });
    expect(get.text).not.toContain(KEY);

    const again = await call('POST', '/config', { ledgers: { [NET]: { rpcUrl: RPC } } });
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ ok: true, applied: false, revision: 1 });
  });

  test('POST /config status codes: 409 version, 400 shape and JSON, 422 values, 500 apply failed', async () => {
    const version = await call('POST', '/config', { version: 'test-config/9', ledgers: {} });
    expect(version.status).toBe(409);
    expect(version.body.code).toBe(ERROR_CODES.versionMismatch);

    expect((await call('POST', '/config', { accounts: {} })).status).toBe(400);
    expect((await call('POST', '/config', undefined, '[1,2]')).status).toBe(400);
    const json = await call('POST', '/config', undefined, '{"ledgers":');
    expect(json.status).toBe(400);
    expect(json.body.code).toBe(ERROR_CODES.badRequest);

    const values = await call('POST', '/config', { ledgers: { notcaip2: { rpcUrl: RPC } } });
    expect(values.status).toBe(422);
    expect(values.body.errors[0]).toMatchObject({ path: 'ledgers.notcaip2', code: ERROR_CODES.badLedger });

    handler.failApply = new Error(`down ${KEY}`);
    const failed = await call('POST', '/config', { ledgers: { [NET]: { rpcUrl: RPC, operatorKey: KEY } } });
    expect(failed.status).toBe(500);
    expect(failed.body.errors[0]).toMatchObject({ code: ERROR_CODES.applyFailed, message: 'down ***' });
    expect(failed.text).not.toContain(KEY);
  });

  test('413 for a body over the limit, and other routes keep their own parsing', async () => {
    const big = await call('POST', '/config', { ledgers: { [NET]: { rpcUrl: 'x'.repeat(20_000) } } });
    expect(big.status).toBe(413);
    const other = await call('POST', '/other', undefined, '{"a":1}');
    expect(other.status).toBe(200);
    expect(other.body).toEqual({ body: null });
  });

  test('the old routes are gone', async () => {
    expect((await call('POST', '/config/apply', { values: {} })).status).toBe(404);
    expect((await call('POST', '/config/validate', { values: {} })).status).toBe(404);
  });
});

import express from 'express';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AddressInfo } from 'node:net';
import { Server } from 'node:http';
import winston from 'winston';
import { registerConfigRoutes } from '../../src/config/routes';
import { ConfigRuntime } from '../../src/config/runtime';
import { MemoryConfigStore } from '../../src/config/store';
import { loadWizard } from '../../src/config/wizard/manifest';
import { WizardCall, WizardOperation, WizardRefusal } from '../../src/config/wizard/types';
import { adapter, fakeHandler, SECRET_KEYS, silentLogger, VERSION } from './support/fixtures';
import { Context, controlCenter, ControlCenter, envelope, GrantOpts, mintGrant } from './support/wizard';

interface Res { status: number; body: any; text: string; type: string | null }

const { fetch } = globalThis as unknown as {
  fetch: (url: string, init?: Record<string, unknown>) => Promise<{ status: number; text(): Promise<string>; headers: { get(n: string): string | null } }>;
};

describe('wizard routes', () => {
  let server: Server;
  let base: string;
  let cc: ControlCenter;
  let calls: WizardCall[];
  let operations: Record<string, WizardOperation>;
  let runtime: ConfigRuntime;

  const post = async (op: string, body: Buffer, headers: Record<string, string>): Promise<Res> => {
    const res = await fetch(`${base}/config/operations/${op}`, { method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8', ...headers }, body });
    const text = await res.text();
    let parsed: unknown;
    try { parsed = text ? JSON.parse(text) : undefined; } catch { parsed = undefined; }
    return { status: res.status, body: parsed, text, type: res.headers.get('content-type') };
  };

  /** One step as the relay sends it: the body bytes, a grant over them, the key header when there is one. */
  const step = (g: Omit<GrantOpts, 'body'> & { input?: Record<string, unknown> }, override: { body?: Buffer } = {}) => {
    const body = envelope(g.input ?? {}, g.context as Context | undefined);
    const grant = mintGrant(cc, { ...g, body });
    return post(g.op, override.body ?? body, { authorization: `Bearer ${grant}`, ...(g.idem ? { 'idempotency-key': g.idem } : {}) });
  };

  beforeEach(async () => {
    cc = controlCenter();
    calls = [];
    const record = (output: Record<string, unknown>): WizardOperation => async (call) => { calls.push(call); return output; };
    operations = {
      'get-status': record({ state: 'active' }),
      check: async (call) => {
        calls.push(call);
        if (call.input.apiKey === 'ak_bad') throw new WizardRefusal('INVALID_CREDENTIALS', { field: '/apiKey' });
        return { valid: true };
      },
      activate: record({ state: 'active' }),
      'activate-network': record({ state: 'active' }),
    };
    runtime = new ConfigRuntime({ version: VERSION, adapter, secretKeys: SECRET_KEYS, handler: fakeHandler(), store: new MemoryConfigStore(), logger: silentLogger });
    const app = express();
    registerConfigRoutes(app, runtime, {
      logger: winston.createLogger({ silent: true }),
      wizard: { wizard: loadWizard(cc.dir), operations: new Proxy(operations, { get: (t, k: string) => t[k] }) },
    });
    await new Promise<void>((resolve) => { server = app.listen(0, resolve); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('serves the signed manifest as is', async () => {
    const res = await fetch(`${base}/config/manifest`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(cc.manifestJws);
  });

  it('runs the status read and an integration step with a valid grant', async () => {
    const status = await step({ flow: '_status', op: 'get-status' });
    expect(status.status).toBe(200);
    expect(status.body).toEqual({ output: { state: 'active' } });
    expect(status.type).toMatch(/^application\/json/);

    const check = await step({ flow: 'connect', op: 'check', input: { apiKey: 'ak_1' } });
    expect(check.body).toEqual({ output: { valid: true } });
    expect(calls[1]).toMatchObject({ operationId: 'check', flow: 'connect', scope: 'integration', subject: 'user:7', input: { apiKey: 'ak_1' } });
  });

  it('passes the network of a network step', async () => {
    const context: Context = { scope: 'network', targetKind: 'network', targetId: 'eip155:31337' };
    const res = await step({ flow: 'network', op: 'activate-network', context, idem: randomUUID() });
    expect(res.status).toBe(200);
    expect(calls[0]).toMatchObject({ scope: 'network', targetId: 'eip155:31337' });
  });

  it.each([
    ['signature', { key: generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey }],
    ['audience', { claims: { aud: 'adapter:other:gca1' } }],
    ['org', { claims: { org: 'bank-uk' } }],
    ['expired', { iat: Math.floor(Date.now() / 1000) - 600 }],
    ['flow', { flow: 'network' }],
    ['operation', { claims: { op: 'activate' } }],
  ])('refuses a grant with reason %s', async (reason, change) => {
    const res = await step({ flow: 'connect', op: 'check', input: { apiKey: 'ak_1' }, ...(change as Partial<GrantOpts>) });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: { code: 'GRANT_INVALID', reason } });
    expect(calls).toHaveLength(0);
  });

  it('refuses a body the grant was not minted for, and a replayed grant', async () => {
    const tampered = await step({ flow: 'connect', op: 'check', input: { apiKey: 'ak_1' } }, { body: envelope({ apiKey: 'ak_2' }) });
    expect(tampered.body.error.reason).toBe('body');

    const body = envelope({ apiKey: 'ak_1' });
    const grant = mintGrant(cc, { flow: 'connect', op: 'check', body });
    expect((await post('check', body, { authorization: `Bearer ${grant}` })).status).toBe(200);
    const again = await post('check', body, { authorization: `Bearer ${grant}` });
    expect(again.body).toEqual({ error: { code: 'GRANT_INVALID', reason: 'replay' } });
  });

  it('refuses input outside the request schema with the field, and passes a refusal of the operation', async () => {
    const invalid = await step({ flow: 'connect', op: 'check', input: { apiKey: 'nope' } });
    expect(invalid.status).toBe(400);
    expect(invalid.body).toEqual({ error: { code: 'INVALID_INPUT', field: '/apiKey' } });

    const refused = await step({ flow: 'connect', op: 'check', input: { apiKey: 'ak_bad' } });
    expect(refused.status).toBe(422);
    expect(refused.body).toEqual({ error: { code: 'INVALID_CREDENTIALS', field: '/apiKey' } });
  });

  it('runs a keyed step once and refuses the key for another request', async () => {
    const idem = randomUUID();
    const first = await step({ flow: 'connect', op: 'activate', input: { apiKey: 'ak_1' }, idem });
    const retry = await step({ flow: 'connect', op: 'activate', input: { apiKey: 'ak_1' }, idem });
    expect([first.status, retry.status]).toEqual([200, 200]);
    expect(calls).toHaveLength(1);
    const other = await step({ flow: 'connect', op: 'activate', input: { apiKey: 'ak_2' }, idem });
    expect(other.status).toBe(409);
    expect(other.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');

    const unkeyed = await step({ flow: 'connect', op: 'activate', input: { apiKey: 'ak_1' } });
    expect(unkeyed.body).toEqual({ error: { code: 'GRANT_INVALID', reason: 'idempotency' } });
  });

  it('answers 500 for an output outside the response schema or a thrown error, without the message', async () => {
    operations['get-status'] = async () => ({ state: 'x'.repeat(40) });
    const invalid = await step({ flow: '_status', op: 'get-status' });
    expect(invalid.status).toBe(500);
    expect(invalid.body).toEqual({ error: { code: 'RESPONSE_INVALID' } });

    operations['get-status'] = async () => { throw new Error('secret value 0xabc'); };
    const thrown = await step({ flow: '_status', op: 'get-status' });
    expect(thrown.body).toEqual({ error: { code: 'INTERNAL_ERROR' } });
    expect(thrown.text).not.toContain('0xabc');
  });

  it('refuses an unknown operation, another content type and a missing grant', async () => {
    expect((await post('nope', envelope({}), {})).status).toBe(404);
    expect((await post('check', envelope({}), { 'content-type': 'text/plain' })).status).toBe(415);
    expect((await post('check', envelope({}), {})).body).toEqual({ error: { code: 'GRANT_INVALID', reason: 'malformed' } });
  });

  it('keeps POST /config on its JSON parser next to the wizard routes', async () => {
    const res = await fetch(`${base}/config`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ version: 'other/1' }) });
    expect(res.status).toBe(409);
    const bad = await fetch(`${base}/config`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' });
    expect(bad.status).toBe(400);
  });
});

describe('loadWizard', () => {
  it('refuses a manifest that does not match its pinned digest, and a missing handler', () => {
    const cc = controlCenter();
    writeFileSync(join(cc.dir, 'manifest.jws'), `${cc.manifestJws}x`);
    expect(() => loadWizard(cc.dir)).toThrow('does not match manifestDigest');

    const ok = controlCenter();
    const app = express();
    const runtime = new ConfigRuntime({ version: VERSION, adapter, secretKeys: SECRET_KEYS, handler: fakeHandler(), store: new MemoryConfigStore(), logger: silentLogger });
    expect(() => registerConfigRoutes(app, runtime, { wizard: { wizard: loadWizard(ok.dir), operations: {} } }))
      .toThrow('no handler for wizard operation(s): get-status, check, activate, activate-network');
  });
});

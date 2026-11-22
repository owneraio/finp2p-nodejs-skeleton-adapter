// Control Center's side of the wizard contract, for tests: keys, a signed manifest, grants.
import { createHash, generateKeyPairSync, KeyObject, randomBytes, sign } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { manifestDigest, signManifest } from '../../../src/config/wizard/manifest';
import { WizardManifest, WizardOperationSpec, WizardPins } from '../../../src/config/wizard/types';

const limits = { maxBodyBytes: 8192, maxResponseBytes: 16384, timeoutMs: 10000 };
const empty = { type: 'object', additionalProperties: false, properties: {} } as const;

const op = (request: object, response: object, idempotency: 'none' | 'required' = 'none'): WizardOperationSpec =>
  ({ request, response, secretFields: [], idempotency, limits } as WizardOperationSpec);

export const MANIFEST: WizardManifest = {
  manifestVersion: 1,
  wizardId: 'test-adapter',
  adapter: { kind: 'custody', name: 'Test adapter', version: '1.0.0', imageDigest: `sha256:${'0'.repeat(64)}` },
  compatibility: { hostContract: 2 },
  targets: { network: [{ id: 'eip155:31337', label: 'Anvil' }] },
  flows: {
    connect: { title: 'Connect', scope: 'integration', operations: ['check', 'activate'] },
    network: { title: 'Network', scope: 'network', operations: ['activate-network'] },
  },
  status: { operation: 'get-status' },
  operations: {
    'get-status': op(empty, { type: 'object', additionalProperties: false, required: ['state'], properties: { state: { type: 'string', maxLength: 32 } } }),
    check: op(
      { type: 'object', additionalProperties: false, required: ['apiKey'], properties: { apiKey: { type: 'string', minLength: 1, maxLength: 64, pattern: '^ak_' } } },
      { type: 'object', additionalProperties: false, required: ['valid'], properties: { valid: { type: 'boolean' } } },
    ),
    activate: op(
      { type: 'object', additionalProperties: false, required: ['apiKey'], properties: { apiKey: { type: 'string', maxLength: 64 } } },
      { type: 'object', additionalProperties: false, required: ['state'], properties: { state: { type: 'string', maxLength: 16 } } },
      'required',
    ),
    'activate-network': op(empty, { type: 'object', additionalProperties: false, required: ['state'], properties: { state: { type: 'string', maxLength: 16 } } }, 'required'),
  },
};

const p256 = () => generateKeyPairSync('ec', { namedCurve: 'P-256' });

export interface ControlCenter {
  pins: WizardPins;
  manifestJws: string;
  grantKey: KeyObject;
  /** A directory with adapter.json and manifest.jws, as the setup writes them. */
  dir: string;
}

export function controlCenter(manifest: WizardManifest = MANIFEST): ControlCenter {
  const release = p256();
  const grant = p256();
  const manifestJws = signManifest(manifest, release.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string, 'test-release');
  const pins: WizardPins = {
    issuer: 'control-center:bank-us',
    audience: `adapter:${manifest.wizardId}:gca1`,
    org: 'bank-us',
    env: 'test',
    integrationId: 'gca1',
    wizardId: manifest.wizardId,
    grantKid: 'test-grant',
    grantPublicKey: grant.publicKey,
    manifestDigest: manifestDigest(manifestJws),
  };
  const dir = mkdtempSync(join(tmpdir(), 'wizard-'));
  writeFileSync(join(dir, 'manifest.jws'), manifestJws);
  writeFileSync(join(dir, 'adapter.json'), JSON.stringify({
    ...pins, grantPublicKey: undefined, grantPublicKeyPem: grant.publicKey.export({ type: 'spki', format: 'pem' }), manifestPath: 'manifest.jws',
  }));
  return { pins, manifestJws, grantKey: grant.privateKey, dir };
}

export type Context = { scope: 'integration' } | { scope: 'network'; targetKind: 'network'; targetId: string };

export interface GrantOpts {
  flow: string;
  op: string;
  context?: Context;
  body: Buffer;
  idem?: string;
  claims?: Record<string, unknown>;
  key?: KeyObject;
  iat?: number;
}

/** The grant as ownera-apps backend/src/services/AdapterConfig/grant.ts mints it. */
export function mintGrant(cc: ControlCenter, g: GrantOpts): string {
  const header = { alg: 'ES256', kid: cc.pins.grantKid, typ: 'config-grant+jwt' };
  const iat = g.iat ?? Math.floor(Date.now() / 1000);
  const claims = {
    iss: cc.pins.issuer, aud: cc.pins.audience, sub: 'user:7', org: cc.pins.org, env: cc.pins.env,
    integration: cc.pins.integrationId, wizard: cc.pins.wizardId, flow: g.flow, ...(g.context ?? { scope: 'integration' }),
    op: g.op, manifest: cc.pins.manifestDigest, req: createHash('sha256').update(g.body).digest('hex'),
    ...(g.idem ? { idem: g.idem } : {}), iat, exp: iat + 60, jti: randomBytes(16).toString('base64url'),
    ...g.claims,
  };
  const input = `${Buffer.from(JSON.stringify(header)).toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}`;
  const signature = sign('sha256', Buffer.from(input, 'ascii'), { key: g.key ?? cc.grantKey, dsaEncoding: 'ieee-p1363' });
  return `${input}.${signature.toString('base64url')}`;
}

export const envelope = (input: Record<string, unknown>, context: Context = { scope: 'integration' }): Buffer =>
  Buffer.from(JSON.stringify({ context, input }), 'utf8');

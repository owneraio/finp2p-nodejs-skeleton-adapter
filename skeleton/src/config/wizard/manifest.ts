// The wizard files an adapter reads at startup (written by the Control Center setup):
//   <dir>/adapter.json   pins: issuer, audience, org, env, integrationId, wizardId, grantKid,
//                        grantPublicKeyPem, manifestPath, manifestDigest
//   <dir>/manifest.jws   the signed manifest, served as is
// Nothing in them is secret.
import { createPrivateKey, createPublicKey, KeyObject } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { has, isP256Key, isPlainObject, JsonObject, parseCompact, parseJsonObject, sha256Hex, signCompact } from './jws';
import {
  HOST_CONTRACT, ID_PATTERN, MANIFEST_TYP, NETWORK_ID_PATTERN, Wizard, WizardManifest, WizardPins,
} from './types';

export const WIZARD_DIR_ENV = 'ADAPTER_CONFIG_WIZARD_DIR';

export const manifestDigest = (compact: string): string => `sha256:${sha256Hex(Buffer.from(compact, 'utf8'))}`;

/** Signs the exact payload bytes: compact JSON, UTF-8, no trailing newline. */
export function signManifest(manifest: WizardManifest, releaseKeyPem: string, kid: string): string {
  const key = createPrivateKey(releaseKeyPem);
  if (!isP256Key(key)) throw new Error('the release key is not a P-256 key');
  return signCompact({ alg: 'ES256', kid, typ: MANIFEST_TYP }, Buffer.from(JSON.stringify(manifest), 'utf8'), key);
}

/** The structure the adapter routes by. Control Center checks the signature and the rest. */
export function manifestProblem(m: unknown): string | null {
  if (!isPlainObject(m)) return 'not an object';
  const manifest = m as unknown as WizardManifest;
  if (manifest.manifestVersion !== 1) return 'manifestVersion';
  if (typeof manifest.wizardId !== 'string' || !ID_PATTERN.test(manifest.wizardId)) return 'wizardId';
  if (manifest.compatibility?.hostContract !== HOST_CONTRACT) return 'compatibility.hostContract';
  if (!isPlainObject(manifest.operations)) return 'operations';
  for (const [id, op] of Object.entries(manifest.operations)) {
    if (!ID_PATTERN.test(id) || !isPlainObject(op)) return `operations.${id}`;
    if (op.request?.type !== 'object' || op.response?.type !== 'object') return `operations.${id} schemas`;
    if (op.idempotency !== 'none' && op.idempotency !== 'required') return `operations.${id}.idempotency`;
    if (!Number.isSafeInteger(op.limits?.maxBodyBytes) || !Number.isSafeInteger(op.limits?.maxResponseBytes)) return `operations.${id}.limits`;
  }
  if (!isPlainObject(manifest.flows)) return 'flows';
  for (const [id, flow] of Object.entries(manifest.flows)) {
    if (!ID_PATTERN.test(id) || !isPlainObject(flow)) return `flows.${id}`;
    if (flow.scope !== 'integration' && flow.scope !== 'network') return `flows.${id}.scope`;
    if (!Array.isArray(flow.operations) || flow.operations.some((op) => !has(manifest.operations, op))) return `flows.${id}.operations`;
  }
  if (!has(manifest.operations, manifest.status?.operation ?? '')) return 'status.operation';
  const network = manifest.targets?.network;
  if (!Array.isArray(network) || network.some((t) => !NETWORK_ID_PATTERN.test(t?.id))) return 'targets.network';
  return null;
}

const textOf = (raw: JsonObject, field: string): string => {
  const value = raw[field];
  if (typeof value !== 'string' || value === '') throw new Error(`adapter.json has no ${field}`);
  return value;
};

/** Reads and checks the wizard files. Errors name the file and the field, never a value. */
export function loadWizard(dir: string): Wizard {
  const adapterPath = resolve(dir, 'adapter.json');
  let raw: JsonObject | null;
  try {
    raw = parseJsonObject(readFileSync(adapterPath));
  } catch {
    throw new Error(`cannot read ${adapterPath}`);
  }
  if (!raw) throw new Error(`${adapterPath} is not a JSON object`);

  let grantPublicKey: KeyObject;
  try {
    grantPublicKey = createPublicKey(textOf(raw, 'grantPublicKeyPem'));
  } catch {
    throw new Error('adapter.json grantPublicKeyPem is not a public key');
  }
  if (!isP256Key(grantPublicKey)) throw new Error('adapter.json grantPublicKeyPem is not a P-256 key');

  const pins: WizardPins = {
    issuer: textOf(raw, 'issuer'),
    audience: textOf(raw, 'audience'),
    org: textOf(raw, 'org'),
    env: textOf(raw, 'env'),
    integrationId: textOf(raw, 'integrationId'),
    wizardId: textOf(raw, 'wizardId'),
    grantKid: textOf(raw, 'grantKid'),
    grantPublicKey,
    manifestDigest: textOf(raw, 'manifestDigest'),
  };

  const manifestPath = resolve(dir, typeof raw.manifestPath === 'string' ? raw.manifestPath : 'manifest.jws');
  let manifestJws: string;
  try {
    manifestJws = readFileSync(manifestPath, 'utf8');
  } catch {
    throw new Error(`cannot read ${manifestPath}`);
  }
  if (manifestDigest(manifestJws) !== pins.manifestDigest) throw new Error(`${manifestPath} does not match manifestDigest in adapter.json`);
  const parts = parseCompact(manifestJws);
  const payload = parts && parseJsonObject(parts.payloadBytes);
  const problem = manifestProblem(payload);
  if (problem) throw new Error(`the signed manifest is not valid: ${problem}`);
  const manifest = payload as unknown as WizardManifest;
  if (manifest.wizardId !== pins.wizardId) throw new Error('the signed manifest has another wizardId than adapter.json');
  return { pins, manifest, manifestJws };
}

/** The wizard named by ADAPTER_CONFIG_WIZARD_DIR, or undefined when it is unset (wizard routes off). */
export function wizardFromEnv(env: NodeJS.ProcessEnv = process.env): Wizard | undefined {
  const dir = env[WIZARD_DIR_ENV];
  return dir ? loadWizard(dir) : undefined;
}

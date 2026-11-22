// The manifest an adapter serves at GET /config/manifest. Control Center checks it again and
// fails closed on anything unknown (ownera-apps backend services/AdapterConfig/manifest.ts).
import { has, hasOnlyKeys, isPlainObject } from './json';
import {
  HOST_CONTRACT, ID_PATTERN, NETWORK_ID_PATTERN, WizardContext, WizardManifest, WizardScope,
} from './types';

export const MANIFEST_MAX_BYTES = 64 * 1024;
const MANIFEST_KEYS = ['manifestVersion', 'wizardId', 'adapter', 'compatibility', 'targets', 'flows', 'status', 'operations'];
const ADAPTER_KEYS = ['kind', 'name', 'version'];

/** The structure the adapter routes by, or the first part that is wrong. Never a value. */
export function manifestProblem(m: unknown): string | null {
  if (!isPlainObject(m) || !hasOnlyKeys(m, MANIFEST_KEYS)) return 'top-level keys';
  const manifest = m as unknown as WizardManifest;
  if (manifest.manifestVersion !== 1) return 'manifestVersion';
  if (typeof manifest.wizardId !== 'string' || !ID_PATTERN.test(manifest.wizardId)) return 'wizardId';
  const { adapter } = manifest;
  if (!isPlainObject(adapter) || !hasOnlyKeys(adapter, ADAPTER_KEYS) || !ID_PATTERN.test(String(adapter.kind))) return 'adapter';
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
  if (Buffer.byteLength(JSON.stringify(manifest), 'utf8') > MANIFEST_MAX_BYTES) return 'size';
  return null;
}

/** The manifest, checked. The error names the failing part, never a value. */
export function checkManifest(m: unknown): WizardManifest {
  const problem = manifestProblem(m);
  if (problem) throw new Error(`the wizard manifest is not valid: ${problem}`);
  return m as WizardManifest;
}

/** The scopes of the flows that list an operation. The status read is an integration step. */
export function scopesOf(manifest: WizardManifest, operationId: string): Set<WizardScope> {
  const scopes = new Set(Object.values(manifest.flows).filter((f) => f.operations.includes(operationId)).map((f) => f.scope));
  if (manifest.status.operation === operationId) scopes.add('integration');
  return scopes;
}

/** The body's context, when it fits a flow that lists the operation and names a declared network. */
export function contextOf(manifest: WizardManifest, operationId: string, context: unknown): WizardContext | null {
  if (!isPlainObject(context) || !scopesOf(manifest, operationId).has(context.scope as WizardScope)) return null;
  if (context.scope === 'integration') return Object.keys(context).length === 1 ? { scope: 'integration' } : null;
  const fits = Object.keys(context).length === 3
    && context.targetKind === 'network'
    && manifest.targets.network.some((t) => t.id === context.targetId);
  return fits ? { scope: 'network', targetKind: 'network', targetId: context.targetId as string } : null;
}

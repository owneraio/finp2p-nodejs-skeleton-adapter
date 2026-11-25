// The manifest an adapter serves at GET /config/manifest. Control Center checks it again and
// fails closed on anything unknown (ownera-apps backend services/AdapterConfig/manifest.ts).
import { has, hasOnlyKeys, isPlainObject } from './json';
import {
  ControlCenterContext, ControlCenterManifest, ControlCenterScope, HOST_CONTRACT, ID_PATTERN, NETWORK_ID_PATTERN,
} from './types';

export const MANIFEST_MAX_BYTES = 64 * 1024;
/** Control Center's ceilings (ownera-apps AdapterConfig constants.ts LIMIT_CEILINGS): a manifest asking for more is refused whole. */
export const LIMIT_CEILINGS = { maxBodyBytes: 64 * 1024, maxResponseBytes: 1024 * 1024, timeoutMs: 30_000 };
const LIMIT_FLOORS = { maxBodyBytes: 32, maxResponseBytes: 16, timeoutMs: 100 };
const VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,31}$/;
const MAX_NETWORKS = 50;
const MAX_FLOW_OPERATIONS = 32;
const text = (value: unknown, max: number): boolean => typeof value === 'string' && value.length > 0 && value.length <= max;
const MANIFEST_KEYS = ['manifestVersion', 'wizardId', 'adapter', 'compatibility', 'targets', 'flows', 'status', 'operations'];
const ADAPTER_KEYS = ['kind', 'name', 'version'];

/** The structure the adapter routes by, or the first part that is wrong. Never a value. */
export function manifestProblem(m: unknown): string | null {
  if (!isPlainObject(m) || !hasOnlyKeys(m, MANIFEST_KEYS)) return 'top-level keys';
  const manifest = m as unknown as ControlCenterManifest;
  if (manifest.manifestVersion !== 1) return 'manifestVersion';
  if (typeof manifest.wizardId !== 'string' || !ID_PATTERN.test(manifest.wizardId)) return 'wizardId';
  const { adapter } = manifest;
  if (!isPlainObject(adapter) || !hasOnlyKeys(adapter, ADAPTER_KEYS) || !ID_PATTERN.test(String(adapter.kind))) return 'adapter';
  if (!text(adapter.name, 128)) return 'adapter.name';
  if (typeof adapter.version !== 'string' || !VERSION_PATTERN.test(adapter.version)) return 'adapter.version';
  if (manifest.compatibility?.hostContract !== HOST_CONTRACT) return 'compatibility.hostContract';
  if (!isPlainObject(manifest.operations)) return 'operations';
  for (const [id, op] of Object.entries(manifest.operations)) {
    if (!ID_PATTERN.test(id) || !isPlainObject(op)) return `operations.${id}`;
    if (op.request?.type !== 'object' || op.response?.type !== 'object') return `operations.${id} schemas`;
    // the skeleton keeps no idempotency state, so an operation that declared it required would be a promise it cannot keep
    if (op.idempotency !== 'none') return `operations.${id}.idempotency`;
    for (const key of ['maxBodyBytes', 'maxResponseBytes', 'timeoutMs'] as const) {
      const limit = op.limits?.[key];
      if (!Number.isSafeInteger(limit) || limit < LIMIT_FLOORS[key] || limit > LIMIT_CEILINGS[key]) return `operations.${id}.limits.${key}`;
    }
  }
  if (!isPlainObject(manifest.flows)) return 'flows';
  for (const [id, flow] of Object.entries(manifest.flows)) {
    if (!ID_PATTERN.test(id) || !isPlainObject(flow)) return `flows.${id}`;
    if (flow.scope !== 'integration' && flow.scope !== 'network') return `flows.${id}.scope`;
    if (!text(flow.title, 128)) return `flows.${id}.title`;
    if (!Array.isArray(flow.operations) || flow.operations.length === 0 || flow.operations.length > MAX_FLOW_OPERATIONS
      || flow.operations.some((op) => !has(manifest.operations, op))) return `flows.${id}.operations`;
  }
  if (!has(manifest.operations, manifest.status?.operation ?? '')) return 'status.operation';
  const network = manifest.targets?.network;
  if (!Array.isArray(network) || network.length > MAX_NETWORKS || network.some((t) => !NETWORK_ID_PATTERN.test(t?.id))) return 'targets.network';
  if (network.some((t) => !text(t.label, 128))) return 'targets.network.label';
  if (new Set(network.map((t) => t.id)).size !== network.length) return 'targets.network duplicate';
  if (Buffer.byteLength(JSON.stringify(manifest), 'utf8') > MANIFEST_MAX_BYTES) return 'size';
  return null;
}

/** The manifest, checked. The error names the failing part, never a value. */
export function checkManifest(m: unknown): ControlCenterManifest {
  const problem = manifestProblem(m);
  if (problem) throw new Error(`the Control Center manifest is not valid: ${problem}`);
  return m as ControlCenterManifest;
}

/** The scopes of the flows that list an operation. The status read is an integration step. */
export function scopesOf(manifest: ControlCenterManifest, operationId: string): Set<ControlCenterScope> {
  const scopes = new Set(Object.values(manifest.flows).filter((f) => f.operations.includes(operationId)).map((f) => f.scope));
  if (manifest.status.operation === operationId) scopes.add('integration');
  return scopes;
}

/** The body's context, when it fits a flow that lists the operation and names a declared network. */
export function contextOf(manifest: ControlCenterManifest, operationId: string, context: unknown): ControlCenterContext | null {
  if (!isPlainObject(context) || !scopesOf(manifest, operationId).has(context.scope as ControlCenterScope)) return null;
  if (context.scope === 'integration') return Object.keys(context).length === 1 ? { scope: 'integration' } : null;
  const fits = Object.keys(context).length === 3
    && context.targetKind === 'network'
    && manifest.targets.network.some((t) => t.id === context.targetId);
  return fits ? { scope: 'network', targetKind: 'network', targetId: context.targetId as string } : null;
}

// Control Center's side of host contract 2, for tests: a manifest and the body its relay sends.
import { ControlCenterContext, ControlCenterManifest, ControlCenterOperationSpec } from '../../../src/config';

const limits = { maxBodyBytes: 8192, maxResponseBytes: 16384, timeoutMs: 10000 };
const empty = { type: 'object', additionalProperties: false, properties: {} } as const;

const op = (request: object, response: object): ControlCenterOperationSpec =>
  ({ request, response, secretFields: [], idempotency: 'none', limits } as ControlCenterOperationSpec);

export const MANIFEST: ControlCenterManifest = {
  manifestVersion: 1,
  wizardId: 'test-adapter',
  adapter: { kind: 'custody', name: 'Test adapter', version: '1.0.0' },
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
    ),
    'activate-network': op(empty, { type: 'object', additionalProperties: false, required: ['state'], properties: { state: { type: 'string', maxLength: 16 } } }),
  },
};

export const NETWORK: ControlCenterContext = { scope: 'network', targetKind: 'network', targetId: 'eip155:31337' };

/** The body as ownera-apps backend/src/services/AdapterConfig/relay.ts sends it. */
export const envelope = (input: Record<string, unknown>, context: object = { scope: 'integration' }): Buffer =>
  Buffer.from(JSON.stringify({ context, input }), 'utf8');

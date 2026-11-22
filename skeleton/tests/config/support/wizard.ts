// Control Center's side of the wizard contract, for tests: a manifest and the body the relay sends.
import { WizardContext, WizardManifest, WizardOperationSpec } from '../../../src/config/wizard/types';

const limits = { maxBodyBytes: 8192, maxResponseBytes: 16384, timeoutMs: 10000 };
const empty = { type: 'object', additionalProperties: false, properties: {} } as const;

const op = (request: object, response: object, idempotency: 'none' | 'required' = 'none'): WizardOperationSpec =>
  ({ request, response, secretFields: [], idempotency, limits } as WizardOperationSpec);

export const MANIFEST: WizardManifest = {
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
      'required',
    ),
    'activate-network': op(empty, { type: 'object', additionalProperties: false, required: ['state'], properties: { state: { type: 'string', maxLength: 16 } } }, 'required'),
  },
};

export const NETWORK: WizardContext = { scope: 'network', targetKind: 'network', targetId: 'eip155:31337' };

/** The body as ownera-apps backend/src/services/AdapterConfig/relay.ts sends it. */
export const envelope = (input: Record<string, unknown>, context: object = { scope: 'integration' }): Buffer =>
  Buffer.from(JSON.stringify({ context, input }), 'utf8');

// Control Center's side of host contract 2, for tests: the identity an adapter passes and the body the relay sends.
import { ControlCenterIdentity } from '../../../src/config';

export const IDENTITY: ControlCenterIdentity = {
  wizardId: 'test-adapter',
  adapter: { kind: 'custody', name: 'Test adapter', version: '1.0.0' },
};

/** The body as ownera-apps backend/src/services/AdapterConfig/relay.ts sends it. */
export const envelope = (input: Record<string, unknown>, context: object = { scope: 'integration' }): Buffer =>
  Buffer.from(JSON.stringify({ context, input }), 'utf8');

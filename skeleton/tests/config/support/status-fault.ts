// Copied from ownera-apps packages/backend/src/services/AdapterConfig/status.ts
// (branch feature/demo, commit 8247b42b8): Control Center's own rules for a status answer, on top of
// the declared response schema. Only the imports differ. The tests check every status answer with it.
/* eslint-disable */
type AdapterConfigState = 'not_configured' | 'active' | 'needs_attention';
import { ID_PATTERN } from '../../../src/config/control-center/types';
import { hasOnlyKeys, isPlainObject } from '../../../src/config/control-center/json';

const STATES: ReadonlySet<AdapterConfigState> = new Set(['not_configured', 'active', 'needs_attention']);

/** At most this many label and value pairs per integration or network, each one short. */
export const STATUS_DETAIL_LIMIT = 8;
const LABEL_MAX = 64;
const VALUE_MAX = 128;

const isText = (value: unknown, min: number, max: number): boolean =>
  typeof value === 'string' && value.length >= min && value.length <= max;

const isState = (value: unknown): boolean => typeof value === 'string' && STATES.has(value as AdapterConfigState);

const detailsFault = (value: unknown, path: string): string | undefined => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > STATUS_DETAIL_LIMIT) return path;
  const ids = new Set<string>();
  for (const [index, detail] of value.entries()) {
    const at = `${path}/${index}`;
    if (!isPlainObject(detail) || !hasOnlyKeys(detail, ['id', 'label', 'value'])) return at;
    if (typeof detail.id !== 'string' || !ID_PATTERN.test(detail.id) || ids.has(detail.id)) return `${at}/id`;
    ids.add(detail.id);
    if (!isText(detail.label, 1, LABEL_MAX)) return `${at}/label`;
    if (!isText(detail.value, 0, VALUE_MAX)) return `${at}/value`;
  }
  return undefined;
};

/**
 * Control Center's own rules for a status answer, on top of the adapter's declared response schema: the envelope the
 * host and the adapter's summary screen rely on. Returns the JSON pointer of the first fault, never a value.
 * Networks must be ones the manifest declares, each listed once.
 */
export const statusFault = (output: unknown, declaredNetworks: ReadonlySet<string>): string | undefined => {
  if (!isPlainObject(output) || !hasOnlyKeys(output, ['integration', 'networks'])) return '';
  const { integration, networks } = output;
  if (!isPlainObject(integration) || !hasOnlyKeys(integration, ['state', 'details'])) return '/integration';
  if (!isState(integration.state)) return '/integration/state';
  const integrationFault = detailsFault(integration.details, '/integration/details');
  if (integrationFault !== undefined) return integrationFault;

  if (!Array.isArray(networks) || networks.length > declaredNetworks.size) return '/networks';
  const seen = new Set<string>();
  for (const [index, network] of networks.entries()) {
    const at = `/networks/${index}`;
    if (!isPlainObject(network) || !hasOnlyKeys(network, ['id', 'state', 'details'])) return at;
    if (typeof network.id !== 'string' || !declaredNetworks.has(network.id) || seen.has(network.id)) return `${at}/id`;
    seen.add(network.id);
    if (!isState(network.state)) return `${at}/state`;
    const networkFault = detailsFault(network.details, `${at}/details`);
    if (networkFault !== undefined) return networkFault;
  }
  return undefined;
};

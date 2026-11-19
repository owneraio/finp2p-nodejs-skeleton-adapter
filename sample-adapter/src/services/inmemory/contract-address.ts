import { ContractAddressFormat } from '@owneraio/finp2p-nodejs-skeleton-adapter';

const DEFAULT_PORTS: Record<string, string> = { http: '80', https: '443', ws: '80', wss: '443', ftp: '21' };
const URL_PARTS = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/(?:([^/?#@]*)@)?([^/?#]*?)(?::(\d*))?(?=[/?#]|$)([\s\S]*)$/;

const normalizeUrl = (address: string): string => {
  const parts = URL_PARTS.exec(address);
  if (!parts) {
    return address;
  }
  const [, scheme, userInfo, host, port, rest] = parts;
  const lowerScheme = scheme.toLowerCase();
  const keptPort = port && port !== DEFAULT_PORTS[lowerScheme] ? `:${port}` : '';
  const path = rest === '' || /^[?#]/.test(rest) ? `/${rest}` : rest;
  return `${lowerScheme}://${userInfo !== undefined ? `${userInfo}@` : ''}${host.toLowerCase()}${keptPort}${path}`;
};

/**
 * The form the router compares two addresses in: caip10 lowercased; url scheme and host
 * lowercased, default port dropped, empty path "/"; opaque exact.
 */
export const normalizeContractAddress = (address: string, format: ContractAddressFormat): string => {
  switch (format) {
    case 'caip10': return address.toLowerCase();
    case 'url': return normalizeUrl(address);
    default: return address;
  }
};

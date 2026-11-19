import { ContractAddressFormat } from '@owneraio/finp2p-nodejs-skeleton-adapter';

export const CONTRACT_ADDRESS_FORMATS: ContractAddressFormat[] = ['caip10', 'url', 'opaque'];

const CAIP10 = /^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}:[-.%a-zA-Z0-9]{1,128}$/;
const URL_PARTS = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/?#]*)([\s\S]*)$/;
const DEFAULT_PORTS: Record<string, string> = { http: '80', https: '443', ws: '80', wss: '443', ftp: '21' };

type UrlParts = { scheme: string; userInfo: string; host: string; port: string; rest: string };

const parseUrl = (address: string): UrlParts | undefined => {
  const parts = URL_PARTS.exec(address);
  if (!parts) {
    return undefined;
  }
  const at = parts[2].lastIndexOf('@');
  const hostPort = /^(.*):(\d*)$/.exec(parts[2].slice(at + 1));
  return {
    scheme: parts[1],
    userInfo: parts[2].slice(0, at + 1),
    host: hostPort ? hostPort[1] : parts[2].slice(at + 1),
    port: hostPort ? hostPort[2] : '',
    rest: parts[3],
  };
};

const formatUrl = ({ scheme, userInfo, host, port, rest }: UrlParts): string =>
  `${scheme}://${userInfo}${host}${port ? `:${port}` : ''}${rest}`;

const normalizeUrl = (address: string): string => {
  const url = parseUrl(address);
  if (!url) {
    return address;
  }
  const scheme = url.scheme.toLowerCase();
  return formatUrl({
    ...url,
    scheme,
    host: url.host.toLowerCase(),
    port: url.port === DEFAULT_PORTS[scheme] ? '' : url.port,
    rest: url.rest === '' || /^[?#]/.test(url.rest) ? `/${url.rest}` : url.rest,
  });
};

/** The form the router compares: caip10 lowercased; url scheme and host lowercased, default port dropped, empty path "/"; opaque exact. */
export const normalizeContractAddress = (address: string, format: ContractAddressFormat): string => {
  switch (format) {
    case 'caip10': return address.toLowerCase();
    case 'url': return normalizeUrl(address);
    default: return address;
  }
};

export const isValidContractAddress = (address: string, format: ContractAddressFormat): boolean => {
  switch (format) {
    case 'caip10': return CAIP10.test(address);
    case 'url': return (parseUrl(address)?.host ?? '') !== '';
    default: return address.length > 0 && address.trim() === address;
  }
};

/** Writes the same contract another way, as the router may when it echoes another asset's spelling. Opaque has one spelling. */
export const respellContractAddress = (address: string, format: ContractAddressFormat): string => {
  switch (format) {
    case 'caip10': return address === address.toUpperCase() ? address.toLowerCase() : address.toUpperCase();
    case 'url': {
      const url = parseUrl(address);
      if (!url) {
        return address;
      }
      return formatUrl({
        ...url,
        scheme: url.scheme.toUpperCase(),
        host: url.host.toUpperCase(),
        port: url.port || DEFAULT_PORTS[url.scheme.toLowerCase()] || '',
      });
    }
    default: return address;
  }
};

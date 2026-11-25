import { ContractAddressFormat } from '@owneraio/finp2p-nodejs-skeleton-adapter';

const CAIP10 = /^([-a-zA-Z0-9]{3,8}):([-_a-zA-Z0-9]{1,32}):([-.%a-zA-Z0-9]{1,128})$/;
const EIP155_ACCOUNT = /^0x[0-9a-fA-F]{40}$/;
const SPACE = /[\t\n\v\f\r \u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]/;
const CONTROL = /[\u0000-\u001F\u007F]/;
const SCHEME = /^([A-Za-z][A-Za-z0-9+.-]*):/;
const HOST_CHARS = /^[A-Za-z0-9\-_.~!$&'()*+,;=:[\]<>"]$/;
const VALID_ENCODED_PATH = /^[A-Za-z0-9\-_.~!$&'()*+,;=:@[\]%/]*$/;
const PATH_LITERALS = /^[A-Za-z0-9\-_.~$&+,/:;=@]$/;
const UNRESERVED = /^[A-Za-z0-9\-._~]$/;
const DEFAULT_PORTS: Record<string, string> = { http: '80', https: '443' };
const HEX = /^[0-9a-fA-F]{2}$/;

const trimmed = (address: string): boolean =>
  address !== '' && !SPACE.test(address[0]) && !SPACE.test(address[address.length - 1]);

const hasEscapeAt = (s: string, i: number): boolean => i + 2 < s.length && HEX.test(s.slice(i + 1, i + 3));

/** True when every percent sign starts a two-digit hex escape. */
const validEscapes = (s: string): boolean => {
  for (let i = s.indexOf('%'); i >= 0; i = s.indexOf('%', i + 1)) {
    if (!hasEscapeAt(s, i)) {
      return false;
    }
  }
  return true;
};

const normalizeCaip10 = (address: string): string | undefined => {
  const parts = CAIP10.exec(address);
  if (!parts) {
    return undefined;
  }
  const namespace = parts[1].toLowerCase();
  if (namespace !== 'eip155') {
    return `${namespace}:${parts[2]}:${parts[3]}`;
  }
  return EIP155_ACCOUNT.test(parts[3]) ? `${namespace}:${parts[2]}:${parts[3].toLowerCase()}` : undefined;
};

/** Decodes a path the way a URL parser does; undefined for a malformed percent escape. */
const unescapePath = (raw: string): number[] | undefined => {
  const bytes: number[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    if (raw[i] !== '%') {
      const char = String.fromCodePoint(raw.codePointAt(i)!);
      bytes.push(...Buffer.from(char, 'utf8'));
      i += char.length - 1;
    } else if (hasEscapeAt(raw, i)) {
      bytes.push(parseInt(raw.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      return undefined;
    }
  }
  return bytes;
};

const escapePath = (bytes: number[]): string => bytes
  .map((b) => (b < 0x80 && PATH_LITERALS.test(String.fromCharCode(b)) ? String.fromCharCode(b) : `%${b.toString(16).toUpperCase().padStart(2, '0')}`))
  .join('');

/** The path as it is written on the wire: as given when that is valid, else re-escaped. */
const escapedPath = (raw: string): string | undefined => {
  const bytes = unescapePath(raw);
  if (bytes === undefined) {
    return undefined;
  }
  return VALID_ENCODED_PATH.test(raw) ? raw : escapePath(bytes);
};

/** Uppercases percent-encoded hex and decodes unreserved characters (RFC 3986 6.2.2.2). */
const normalizePercentEncoding = (s: string): string => {
  let out = '';
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] === '%' && hasEscapeAt(s, i)) {
      const byte = parseInt(s.slice(i + 1, i + 3), 16);
      out += byte < 0x80 && UNRESERVED.test(String.fromCharCode(byte)) ? String.fromCharCode(byte) : `%${s.slice(i + 1, i + 3).toUpperCase()}`;
      i += 2;
    } else {
      out += s[i];
    }
  }
  return out;
};

/** Resolves "." and ".." segments (RFC 3986 5.2.4). */
const removeDotSegments = (path: string): string => {
  let input = path;
  let out = '';
  const dropLastSegment = () => {
    const i = out.lastIndexOf('/');
    out = i >= 0 ? out.slice(0, i) : '';
  };
  while (input !== '') {
    if (input.startsWith('../')) {
      input = input.slice(3);
    } else if (input.startsWith('./')) {
      input = input.slice(2);
    } else if (input.startsWith('/./')) {
      input = input.slice(2);
    } else if (input === '/.') {
      input = '/';
    } else if (input.startsWith('/../')) {
      input = input.slice(3);
      dropLastSegment();
    } else if (input === '/..') {
      input = '/';
      dropLastSegment();
    } else if (input === '.' || input === '..') {
      input = '';
    } else {
      const next = input.indexOf('/', 1);
      out += next < 0 ? input : input.slice(0, next);
      input = next < 0 ? '' : input.slice(next);
    }
  }
  return out;
};

const validOptionalPort = (port: string): boolean => port === '' || /^:\d*$/.test(port);

/** The host of an authority, with escaped non-ASCII bytes decoded; undefined when it is malformed. */
const parseHost = (authority: string): string | undefined => {
  if (authority.includes('@')) {
    return undefined;
  }
  if (authority.startsWith('[')) {
    const close = authority.lastIndexOf(']');
    if (close < 0 || !validOptionalPort(authority.slice(close + 1)) || authority.slice(0, close).includes('%25')) {
      return undefined;
    }
  } else {
    const colon = authority.lastIndexOf(':');
    // more than one colon is an IPv6 host that needs brackets
    if (colon !== authority.indexOf(':') || (colon >= 0 && !validOptionalPort(authority.slice(colon)))) {
      return undefined;
    }
  }
  const bytes: number[] = [];
  for (let i = 0; i < authority.length; i += 1) {
    const char = String.fromCodePoint(authority.codePointAt(i)!);
    if (char === '%') {
      // only escaped non-ASCII bytes are allowed in a host
      if (!hasEscapeAt(authority, i) || parseInt(authority[i + 1], 16) < 8) {
        return undefined;
      }
      bytes.push(parseInt(authority.slice(i + 1, i + 3), 16));
      i += 2;
    } else if (char.length === 1 && char.charCodeAt(0) < 0x80 && !HOST_CHARS.test(char)) {
      return undefined;
    } else {
      bytes.push(...Buffer.from(char, 'utf8'));
      i += char.length - 1;
    }
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(bytes));
  } catch {
    return undefined;
  }
};

const normalizeHost = (scheme: string, host: string): string => {
  const lower = host.toLowerCase();
  const colon = lower.lastIndexOf(':');
  const port = colon >= 0 && validOptionalPort(lower.slice(colon)) ? lower.slice(colon + 1) : '';
  if (port === '' && lower.endsWith(':')) {
    return lower.slice(0, -1);
  }
  return port !== '' && DEFAULT_PORTS[scheme] === port ? lower.slice(0, -(port.length + 1)) : lower;
};

const normalizeUrl = (address: string): string | undefined => {
  const schemeMatch = SCHEME.exec(address);
  if (!trimmed(address) || address.includes('#') || CONTROL.test(address) || !schemeMatch) {
    return undefined;
  }
  const scheme = schemeMatch[1].toLowerCase();
  let rest = address.slice(schemeMatch[0].length);
  const queryAt = rest.indexOf('?');
  const query = queryAt >= 0 ? rest.slice(queryAt) : '';
  rest = queryAt >= 0 ? rest.slice(0, queryAt) : rest;

  if (!validEscapes(query)) {
    return undefined;
  }
  if (!rest.startsWith('/')) {
    // an opaque URL such as mailto:a@b.c has its percent-encoding normalized like a path
    return rest === '' || !validEscapes(rest) ? undefined : `${scheme}:${normalizePercentEncoding(rest)}${query}`;
  }
  const hasAuthority = rest.startsWith('//');
  let host = '';
  if (hasAuthority) {
    const slash = rest.indexOf('/', 2);
    const parsed = parseHost(slash >= 0 ? rest.slice(2, slash) : rest.slice(2));
    if (parsed === undefined) {
      return undefined;
    }
    host = parsed;
    rest = slash >= 0 ? rest.slice(slash) : '';
  }
  if (host === '' && rest === '') {
    return undefined;
  }
  const escaped = escapedPath(rest);
  if (escaped === undefined) {
    return undefined;
  }
  let path = removeDotSegments(normalizePercentEncoding(escaped));
  if (path === '' && hasAuthority) {
    path = '/';
  }
  if (!hasAuthority && path.startsWith('//')) {
    return undefined;
  }
  return `${scheme}:${hasAuthority ? `//${normalizeHost(scheme, host)}` : ''}${path}${query}`;
};

/**
 * The form the router compares two addresses in, or undefined when the address is not valid
 * for its format. caip10: namespace lowercased, an eip155 account lowercased too. url: scheme
 * and host lowercased, default http and https port dropped, percent-encoding and dot segments
 * normalized, empty path "/", an opaque part such as mailto: normalized like a path. opaque: kept exactly.
 */
export const normalizeContractAddress = (address: string, format: ContractAddressFormat): string | undefined => {
  switch (format) {
    case 'caip10': return normalizeCaip10(address);
    case 'url': return normalizeUrl(address);
    case 'opaque': return trimmed(address) ? address : undefined;
    default: return undefined;
  }
};

export const isValidContractAddress = (address: string, format: ContractAddressFormat): boolean =>
  normalizeContractAddress(address, format) !== undefined;

/** Two addresses name the same contract when formats match and they are equal normalized; one that does not parse equals only the identical string. */
export const sameContract = (
  a: { address: string; addressFormat: ContractAddressFormat },
  b: { address: string; addressFormat: ContractAddressFormat },
): boolean => {
  if (a.addressFormat !== b.addressFormat) {
    return false;
  }
  const left = normalizeContractAddress(a.address, a.addressFormat);
  const right = normalizeContractAddress(b.address, b.addressFormat);
  return left === undefined || right === undefined ? a.address === b.address : left === right;
};

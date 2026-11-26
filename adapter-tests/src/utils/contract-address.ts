import { createHash } from 'crypto';
import { isIPv6 } from 'net';
import { ContractAddressFormat } from '@owneraio/finp2p-nodejs-skeleton-adapter';

const CAIP10 = /^([-a-zA-Z0-9]{3,8}):([-_a-zA-Z0-9]{1,32}):([-.%a-zA-Z0-9]{1,128})$/;
const EIP155_REFERENCE = /^[1-9][0-9]*$/;
const EIP155_ACCOUNT = /^0x[0-9a-fA-F]{40}$/;
const SPACE = /[\t\n\v\f\r \u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]/;
// control, format and lone surrogate characters; a lone surrogate is not valid UTF-8
const FORBIDDEN = /[\p{Cc}\p{Cf}\p{Cs}]/u;
const MAX_ADDRESS_BYTES = 1024;
const MAX_PORT = 65535;
const SCHEME = /^([A-Za-z][A-Za-z0-9+.-]*):/;
const HOST_CHARS = /^[A-Za-z0-9\-_.~!$&'()*+,;=<>"]$/;
const VALID_ENCODED_PATH = /^[A-Za-z0-9\-_.~!$&'()*+,;=:@[\]%/]*$/;
const PATH_LITERALS = /^[A-Za-z0-9\-_.~$&+,/:;=@]$/;
const UNRESERVED = /^[A-Za-z0-9\-._~]$/;
const DEFAULT_PORTS: Record<string, string> = { http: '80', https: '443' };
const HEX = /^[0-9a-fA-F]{2}$/;

const trimmed = (address: string): boolean =>
  address !== '' && !SPACE.test(address[0]) && !SPACE.test(address[address.length - 1]);

const hasEscapeAt = (s: string, i: number): boolean => i + 2 < s.length && HEX.test(s.slice(i + 1, i + 3));

/** Lowercases A-Z only; every other character stays as written, unlike toLowerCase. */
const lowerAscii = (s: string): string => s.replace(/[A-Z]+/g, (letters) => letters.toLowerCase());

/** The text rules every format shares: at most 1024 bytes, valid UTF-8, no control or format characters. */
const validText = (s: string): boolean => Buffer.byteLength(s, 'utf8') <= MAX_ADDRESS_BYTES && !FORBIDDEN.test(s);

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
  const namespace = lowerAscii(parts[1]);
  if (namespace !== 'eip155') {
    return `${namespace}:${parts[2]}:${parts[3]}`;
  }
  // an eip155 chain reference is a decimal number without leading zeros
  return EIP155_REFERENCE.test(parts[2]) && EIP155_ACCOUNT.test(parts[3])
    ? `${namespace}:${parts[2]}:${parts[3].toLowerCase()}`
    : undefined;
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

const validOptionalPort = (port: string): boolean => port === '' || /^:\d*$/.test(port);

/** A host and the digits of its port ('' when there is none), as the router's URL parser splits them. */
type Authority = { host: string; port: string };

/** Decodes the escaped non-ASCII bytes of a host; undefined for a malformed host or one that is not valid text. */
const decodeHost = (host: string): string | undefined => {
  const bytes: number[] = [];
  for (let i = 0; i < host.length; i += 1) {
    const char = String.fromCodePoint(host.codePointAt(i)!);
    if (char === '%') {
      // only escaped non-ASCII bytes are allowed in a host
      if (!hasEscapeAt(host, i) || parseInt(host[i + 1], 16) < 8) {
        return undefined;
      }
      bytes.push(parseInt(host.slice(i + 1, i + 3), 16));
      i += 2;
    } else if (char.length === 1 && char.charCodeAt(0) < 0x80 && !HOST_CHARS.test(char)) {
      return undefined;
    } else {
      bytes.push(...Buffer.from(char, 'utf8'));
      i += char.length - 1;
    }
  }
  try {
    // ignoreBOM keeps a decoded byte order mark, so it is refused below instead of silently dropped
    const decoded = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.from(bytes));
    return FORBIDDEN.test(decoded) ? undefined : decoded;
  } catch {
    return undefined;
  }
};

/** The host and port of an authority; undefined when it is malformed. */
const parseAuthority = (authority: string): Authority | undefined => {
  if (authority.includes('@')) {
    return undefined;
  }
  let hostPart: string;
  let portPart: string;
  if (authority.startsWith('[')) {
    const close = authority.lastIndexOf(']');
    hostPart = close < 0 ? authority : authority.slice(0, close + 1);
    portPart = close < 0 ? '' : authority.slice(close + 1);
    // a bracketed host is an IPv6 literal, without a zone
    if (close < 0 || hostPart.includes('%') || !isIPv6(hostPart.slice(1, -1))) {
      return undefined;
    }
  } else {
    const colon = authority.lastIndexOf(':');
    // more than one colon is an IPv6 host that needs brackets
    if (colon !== authority.indexOf(':')) {
      return undefined;
    }
    hostPart = colon >= 0 ? authority.slice(0, colon) : authority;
    portPart = colon >= 0 ? authority.slice(colon) : '';
    if (/[[\]]/.test(hostPart)) {
      return undefined;
    }
  }
  if (!validOptionalPort(portPart)) {
    return undefined;
  }
  const host = hostPart.startsWith('[') ? hostPart : decodeHost(hostPart);
  return host === undefined ? undefined : { host, port: portPart.slice(1) };
};

/** The port without leading zeros, '' when it is empty or the scheme's default; undefined above 65535. */
const normalizePort = (scheme: string, port: string): string | undefined => {
  if (port === '') {
    return '';
  }
  const digits = port.replace(/^0+(?=\d)/, '');
  if (digits.length > String(MAX_PORT).length || Number(digits) > MAX_PORT) {
    return undefined;
  }
  return DEFAULT_PORTS[scheme] === digits ? '' : digits;
};

const normalizeUrl = (address: string): string | undefined => {
  const schemeMatch = SCHEME.exec(address);
  if (!trimmed(address) || address.includes('#') || !schemeMatch) {
    return undefined;
  }
  const scheme = lowerAscii(schemeMatch[1]);
  // http and https need a host, so they always have an authority
  const needsHost = scheme === 'http' || scheme === 'https';
  let rest = address.slice(schemeMatch[0].length);
  const queryAt = rest.indexOf('?');
  const query = queryAt >= 0 ? rest.slice(queryAt) : '';
  rest = queryAt >= 0 ? rest.slice(0, queryAt) : rest;

  if (!validEscapes(query)) {
    return undefined;
  }
  if (!rest.startsWith('/')) {
    // an opaque URL such as mailto:a@b.c has its percent-encoding normalized like a path
    return needsHost || rest === '' || !validEscapes(rest) ? undefined : `${scheme}:${normalizePercentEncoding(rest)}${query}`;
  }
  const hasAuthority = rest.startsWith('//');
  let host = '';
  if (hasAuthority) {
    const slash = rest.indexOf('/', 2);
    const authority = parseAuthority(slash >= 0 ? rest.slice(2, slash) : rest.slice(2));
    const port = authority && normalizePort(scheme, authority.port);
    if (!authority || port === undefined) {
      return undefined;
    }
    host = lowerAscii(authority.host) + (port === '' ? '' : `:${port}`);
    rest = slash >= 0 ? rest.slice(slash) : '';
    if (needsHost && authority.host === '') {
      return undefined;
    }
  } else if (needsHost) {
    return undefined;
  }
  if (host === '' && rest === '') {
    return undefined;
  }
  const escaped = escapedPath(rest);
  if (escaped === undefined) {
    return undefined;
  }
  // dot segments are not resolved: "/a/../b" and "/b" are different addresses
  let path = normalizePercentEncoding(escaped);
  if (path === '' && hasAuthority) {
    path = '/';
  }
  return `${scheme}:${hasAuthority ? `//${host}` : ''}${path}${query}`;
};

/**
 * The form the router compares two addresses in, or undefined when the address is not valid
 * for its format. Every format: at most 1024 bytes, valid UTF-8, no control or format characters.
 * caip10: namespace lowercased, an eip155 account lowercased too, a decimal eip155 chain reference.
 * url: scheme and host lowercased (ASCII letters only), port without leading zeros and without the
 * default for http and https, percent-encoding normalized, empty path "/", dot segments kept.
 * opaque: kept exactly.
 */
export const normalizeContractAddress = (address: string, format: ContractAddressFormat): string | undefined => {
  if (!validText(address)) {
    return undefined;
  }
  switch (format) {
    case 'caip10': return normalizeCaip10(address);
    case 'url': return normalizeUrl(address);
    case 'opaque': return trimmed(address) ? address : undefined;
    default: return undefined;
  }
};

export const isValidContractAddress = (address: string, format: ContractAddressFormat): boolean =>
  normalizeContractAddress(address, format) !== undefined;

/** Two addresses name the same contract when formats match and both normalize to the same form; an address that does not normalize equals nothing. */
export const sameContract = (
  a: { address: string; addressFormat: ContractAddressFormat },
  b: { address: string; addressFormat: ContractAddressFormat },
): boolean => {
  if (a.addressFormat !== b.addressFormat) {
    return false;
  }
  const left = normalizeContractAddress(a.address, a.addressFormat);
  const right = normalizeContractAddress(b.address, b.addressFormat);
  return left !== undefined && left === right;
};

export const CONTRACT_ADDRESS_FORMATS: ContractAddressFormat[] = ['caip10', 'url', 'opaque'];

const flipCase = (s: string): string => (s === s.toUpperCase() ? s.toLowerCase() : s.toUpperCase());

/** Uppercases ASCII letters only, so a non-ASCII host keeps the letters that change under full Unicode uppercasing. */
const upperAscii = (s: string): string => s.replace(/[a-z]+/g, (letters) => letters.toUpperCase());

/** Writes the same contract another way, as the router may when it echoes another asset's spelling. Opaque has one spelling. */
export const respellContractAddress = (address: string, format: ContractAddressFormat): string => {
  if (format === 'caip10') {
    const [namespace, reference, account] = address.split(':');
    const spelled = namespace.toLowerCase() === 'eip155' ? `0x${flipCase(account.slice(2))}` : account;
    return `${flipCase(namespace)}:${reference}:${spelled}`;
  }
  const parts = format === 'url' ? /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/?]*)([\s\S]*)$/.exec(address) : null;
  if (!parts) {
    return address;
  }
  const defaultPort = DEFAULT_PORTS[parts[1].toLowerCase()];
  const authority = parts[2].replace(/:$/, '');
  const withPort = defaultPort && !/:\d+$/.test(authority) ? `${authority}:${defaultPort}` : authority;
  return `${upperAscii(parts[1])}://${upperAscii(withPort)}${parts[3]}`;
};

/**
 * A well-formed address in the format of `contract` that is meant to match no listed contract;
 * callers confirm it with sameContract. caip10 keeps the namespace and reference, with an
 * eip155 account of 0x and 40 hex digits; url is an .invalid host; opaque is a plain token.
 */
export const unlistedContractAddress = ({ address, addressFormat }: { address: string; addressFormat: ContractAddressFormat }, id: string): string => {
  const token = `not-listed-${id}`;
  if (addressFormat === 'caip10') {
    const [namespace, reference] = address.split(':');
    const account = namespace.toLowerCase() === 'eip155' ? `0x${createHash('sha256').update(token).digest('hex').slice(0, 40)}` : token;
    return `${namespace}:${reference}:${account}`;
  }
  return addressFormat === 'url' ? `https://${token}.invalid/` : token;
};

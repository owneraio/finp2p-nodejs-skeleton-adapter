/**
 * @jest-environment node
 */
import { contractAddress as suite } from '@owneraio/adapter-tests';
import { ContractAddressFormat } from '@owneraio/finp2p-nodejs-skeleton-adapter';
import * as sample from '../src/services/inmemory/contract-address';

const EVM_CHECKSUM = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const EVM_LOWER = '0x5fbdb2315678afecb367f032d93f642f64180aa3';

type NormalizeCase = { name: string; format: ContractAddressFormat; address: string; want?: string };

/** want is absent when the address is not valid for its format. */
const normalizeCases: NormalizeCase[] = [
  // caip10
  { name: 'eip155 address is lowercased', format: 'caip10', address: `eip155:1:${EVM_CHECKSUM}`, want: `eip155:1:${EVM_LOWER}` },
  { name: 'namespace is lowercased', format: 'caip10', address: `EIP155:137:${EVM_LOWER}`, want: `eip155:137:${EVM_LOWER}` },
  {
    name: 'other namespaces keep the address case',
    format: 'caip10',
    address: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:7S3P4HxJpyyigGzodYwHtCxZyUQe9JiBMHyRWXArAaKv',
    want: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:7S3P4HxJpyyigGzodYwHtCxZyUQe9JiBMHyRWXArAaKv',
  },
  { name: 'reference keeps its case', format: 'caip10', address: 'cosmos:Cosmoshub-4:abc', want: 'cosmos:Cosmoshub-4:abc' },
  { name: 'short eip155 address', format: 'caip10', address: 'eip155:1:0x123' },
  { name: 'eip155 address without 0x', format: 'caip10', address: `eip155:1:${EVM_LOWER.slice(2)}00` },
  { name: 'missing account part', format: 'caip10', address: 'eip155:1' },
  { name: 'namespace too short', format: 'caip10', address: 'ab:1:x' },
  { name: 'caip10 with spaces', format: 'caip10', address: ` eip155:1:${EVM_LOWER}` },

  // url
  { name: 'host lowercased, default port dropped, empty path becomes /', format: 'url', address: 'https://Swap.Example.com:443', want: 'https://swap.example.com/' },
  { name: 'root slash already there', format: 'url', address: 'https://swap.example.com/', want: 'https://swap.example.com/' },
  { name: 'scheme lowercased and http default port dropped', format: 'url', address: 'HTTP://X.com:80/a', want: 'http://x.com/a' },
  { name: 'other ports kept', format: 'url', address: 'https://x.com:8443/a', want: 'https://x.com:8443/a' },
  { name: 'http port on https kept', format: 'url', address: 'https://x.com:80/a', want: 'https://x.com:80/a' },
  { name: 'ws default port kept', format: 'url', address: 'wss://x.com:443/a', want: 'wss://x.com:443/a' },
  { name: 'empty port dropped', format: 'url', address: 'https://x.com:/a', want: 'https://x.com/a' },
  { name: 'trailing slash on a path kept', format: 'url', address: 'https://x.com/v1/', want: 'https://x.com/v1/' },
  { name: 'no trailing slash on a path kept', format: 'url', address: 'https://x.com/v1', want: 'https://x.com/v1' },
  { name: 'dot segments resolved', format: 'url', address: 'https://x.com/a/./b/../c', want: 'https://x.com/a/c' },
  { name: 'dot segments above the root', format: 'url', address: 'https://x.com/../a/..', want: 'https://x.com/' },
  { name: 'unreserved characters decoded, hex uppercased', format: 'url', address: 'https://x.com/%7euser/%2f', want: 'https://x.com/~user/%2F' },
  { name: 'encoded dot resolved as a segment', format: 'url', address: 'https://x.com/a/%2E%2E/b', want: 'https://x.com/b' },
  { name: 'empty segments kept', format: 'url', address: 'https://x.com//a', want: 'https://x.com//a' },
  { name: 'query kept as sent', format: 'url', address: 'https://X.com?b=C&a=%7e', want: 'https://x.com/?b=C&a=%7e' },
  { name: 'empty query kept', format: 'url', address: 'https://x.com/a?', want: 'https://x.com/a?' },
  { name: 'IPv6 host with default port', format: 'url', address: 'https://[::1]:443/a', want: 'https://[::1]/a' },
  { name: 'file URL with empty host', format: 'url', address: 'file:///etc/hosts', want: 'file:///etc/hosts' },
  { name: 'URN kept', format: 'url', address: 'URN:isbn:0451450523', want: 'urn:isbn:0451450523' },
  { name: 'mailto kept', format: 'url', address: 'mailto:a@b.com?subject=X', want: 'mailto:a@b.com?subject=X' },
  { name: 'path with no authority', format: 'url', address: 'foo:/a/./b', want: 'foo:/a/b' },
  { name: 'space in a path is escaped', format: 'url', address: 'https://x.com/a b', want: 'https://x.com/a%20b' },
  { name: 'no scheme', format: 'url', address: 'www.google.com' },
  { name: 'relative path', format: 'url', address: '/v1/swap' },
  { name: 'fragment', format: 'url', address: 'https://x.com/a#top' },
  { name: 'empty fragment', format: 'url', address: 'https://x.com/a#' },
  { name: 'user info', format: 'url', address: 'https://user:pw@x.com/' },
  { name: 'nothing after the scheme', format: 'url', address: 'https:' },
  { name: 'control character', format: 'url', address: 'https://x.com/\x7f' },
  { name: 'url with spaces', format: 'url', address: 'https://x.com/ ' },
  { name: 'bad percent escape in the path', format: 'url', address: 'https://x.com/%zz' },
  { name: 'path that resolves to a host', format: 'url', address: 'https:/.//swap.example.com/v1' },
  { name: 'empty authority keeps a double-slash path', format: 'url', address: 'https:////a', want: 'https:////a' },
  { name: 'IPv6 zone in the host', format: 'url', address: 'http://[fe80::1%25en0]/a' },
  { name: 'escaped percent in the host', format: 'url', address: 'https://ex%25ample.com/' },

  // opaque
  { name: 'opaque kept exactly', format: 'opaque', address: 'Escrow-1', want: 'Escrow-1' },
  { name: 'opaque with inner spaces', format: 'opaque', address: 'my escrow', want: 'my escrow' },
  { name: 'opaque empty', format: 'opaque', address: '' },
  { name: 'opaque leading space', format: 'opaque', address: ' a' },
  { name: 'opaque trailing tab', format: 'opaque', address: 'a\t' },
];

type EqualCase = { name: string; a: [ContractAddressFormat, string]; b: [ContractAddressFormat, string]; want: boolean };

const equalCases: EqualCase[] = [
  { name: 'two spellings of one URL', a: ['url', 'https://Swap.Example.com:443'], b: ['url', 'https://swap.example.com/'], want: true },
  { name: 'trailing slash on a path differs', a: ['url', 'https://x.com/v1'], b: ['url', 'https://x.com/v1/'], want: false },
  { name: 'eip155 checksum and lowercase', a: ['caip10', `eip155:1:${EVM_CHECKSUM}`], b: ['caip10', `eip155:1:${EVM_LOWER}`], want: true },
  { name: 'same eip155 address on another chain', a: ['caip10', `eip155:1:${EVM_LOWER}`], b: ['caip10', `eip155:137:${EVM_LOWER}`], want: false },
  { name: 'opaque compares letter case', a: ['opaque', 'escrow-1'], b: ['opaque', 'Escrow-1'], want: false },
  { name: 'opaque identical', a: ['opaque', 'escrow-1'], b: ['opaque', 'escrow-1'], want: true },
  { name: 'same text, different formats', a: ['opaque', `eip155:1:${EVM_LOWER}`], b: ['caip10', `eip155:1:${EVM_LOWER}`], want: false },
  { name: 'invalid addresses equal only when identical', a: ['url', 'www.x.com'], b: ['url', 'www.x.com'], want: true },
  { name: 'invalid and valid spelling', a: ['url', 'www.x.com'], b: ['url', 'https://www.x.com/'], want: false },
];

describe.each([
  ['adapter-tests', suite],
  ['sample-adapter', sample],
])('contract address normalization in %s', (_name, impl) => {
  test.each(normalizeCases)('normalize: $name', ({ format, address, want }) => {
    const got = impl.normalizeContractAddress(address, format);

    expect(got).toBe(want);
    expect(impl.isValidContractAddress(address, format)).toBe(want !== undefined);
    if (want !== undefined) {
      expect(impl.normalizeContractAddress(want, format)).toBe(want);
    }
  });

  test.each(equalCases)('equal: $name', ({ a, b, want }) => {
    const left = { addressFormat: a[0], address: a[1] };
    const right = { addressFormat: b[0], address: b[1] };

    expect(impl.sameContract(left, right)).toBe(want);
    expect(impl.sameContract(right, left)).toBe(want);
  });
});

describe('both normalizers agree', () => {
  test.each(normalizeCases)('$name', ({ format, address }) => {
    expect(sample.normalizeContractAddress(address, format)).toBe(suite.normalizeContractAddress(address, format));
  });
});

/**
 * @jest-environment node
 */
import { contractAddress as suite, decimal } from '@owneraio/adapter-tests';
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
  { name: 'dot segments kept', format: 'url', address: 'https://x.com/a/./b/../c', want: 'https://x.com/a/./b/../c' },
  { name: 'dot segments above the root kept', format: 'url', address: 'https://x.com/../a/..', want: 'https://x.com/../a/..' },
  { name: 'unreserved characters decoded, hex uppercased', format: 'url', address: 'https://x.com/%7euser/%2f', want: 'https://x.com/~user/%2F' },
  { name: 'encoded dot segment decoded, not resolved', format: 'url', address: 'https://x.com/a/%2E%2E/b', want: 'https://x.com/a/../b' },
  { name: 'lowercase encoded dot segment decoded, not resolved', format: 'url', address: 'https://x.com/admin/%2e%2e/swap', want: 'https://x.com/admin/../swap' },
  { name: 'empty segments kept', format: 'url', address: 'https://x.com//a', want: 'https://x.com//a' },
  { name: 'query kept as sent', format: 'url', address: 'https://X.com?b=C&a=%7e', want: 'https://x.com/?b=C&a=%7e' },
  { name: 'empty query kept', format: 'url', address: 'https://x.com/a?', want: 'https://x.com/a?' },
  { name: 'IPv6 host with default port', format: 'url', address: 'https://[::1]:443/a', want: 'https://[::1]/a' },
  { name: 'file URL with empty host', format: 'url', address: 'file:///etc/hosts', want: 'file:///etc/hosts' },
  { name: 'URN kept', format: 'url', address: 'URN:isbn:0451450523', want: 'urn:isbn:0451450523' },
  { name: 'mailto kept', format: 'url', address: 'mailto:a@b.com?subject=X', want: 'mailto:a@b.com?subject=X' },
  { name: 'opaque part hex uppercased', format: 'url', address: 'urn:example:%2f', want: 'urn:example:%2F' },
  { name: 'opaque part unreserved decoded', format: 'url', address: 'mailto:%41@b.com', want: 'mailto:A@b.com' },
  { name: 'path with no authority keeps its dot segments', format: 'url', address: 'foo:/a/./b', want: 'foo:/a/./b' },
  { name: 'path with no authority and a double slash', format: 'url', address: 'foo:/.//x', want: 'foo:/.//x' },
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
  { name: 'http path with no authority', format: 'url', address: 'https:/.//swap.example.com/v1' },
  { name: 'empty authority keeps a double-slash path', format: 'url', address: 'file:////a', want: 'file:////a' },
  { name: 'IPv6 zone in the host', format: 'url', address: 'http://[fe80::1%25en0]/a' },
  { name: 'escaped percent in the host', format: 'url', address: 'https://ex%25ample.com/' },
  { name: 'unbracketed IPv6 host', format: 'url', address: 'http://::1/a' },
  { name: 'unbracketed colons with no port', format: 'url', address: 'http://::/a' },
  { name: 'bracketed IPv6 host', format: 'url', address: 'http://[::1]/a', want: 'http://[::1]/a' },
  { name: 'invalid percent escape in the query', format: 'url', address: 'https://example.com/?x=%zz' },
  { name: 'truncated percent escape in the query', format: 'url', address: 'https://example.com/?x=%4' },
  { name: 'invalid percent escape in the opaque part', format: 'url', address: 'urn:example:%zz' },

  // url host
  { name: 'https with an empty host', format: 'url', address: 'https:///a' },
  { name: 'http with an empty host', format: 'url', address: 'http:///a' },
  { name: 'https with only a port', format: 'url', address: 'https://:443/' },
  { name: 'https with one slash', format: 'url', address: 'https:/a' },
  { name: 'https with no slashes', format: 'url', address: 'https:a' },
  { name: 'scheme case does not skip the host rule', format: 'url', address: 'HTTPS:///a' },
  { name: 'file with an empty host stays valid', format: 'url', address: 'file:///x', want: 'file:///x' },
  { name: 'other scheme with an empty host stays valid', format: 'url', address: 'foo:///x', want: 'foo:///x' },
  { name: 'host letters lowercased', format: 'url', address: 'https://EXAMPLE.Com/A', want: 'https://example.com/A' },
  { name: 'non-ASCII host letters kept as written', format: 'url', address: 'https://\u0130.example/', want: 'https://\u0130.example/' },
  { name: 'non-ASCII host with a final sigma kept', format: 'url', address: 'https://\u0391\u03a3.example/', want: 'https://\u0391\u03a3.example/' },
  { name: 'non-ASCII lowercase host kept', format: 'url', address: 'https://\u00e9.example/', want: 'https://\u00e9.example/' },
  { name: 'ASCII letters next to a non-ASCII letter lowered', format: 'url', address: 'https://STRA\u00dfE.Example/', want: 'https://stra\u00dfe.example/' },
  { name: 'percent-encoded UTF-8 host decoded', format: 'url', address: 'https://%C3%A9.example/', want: 'https://\u00e9.example/' },
  { name: 'host byte that is not UTF-8', format: 'url', address: 'https://%C3/' },
  { name: 'host byte 0xFF', format: 'url', address: 'https://%FF/' },
  { name: 'host with an encoded zero-width space', format: 'url', address: 'https://a%E2%80%8Bb.example/' },
  { name: 'host with an encoded byte order mark', format: 'url', address: 'https://%EF%BB%BFgate.example/' },
  { name: 'host with an encoded C1 control', format: 'url', address: 'https://a%C2%85b.example/' },
  { name: 'bracketed IPv4 host', format: 'url', address: 'http://[1.2.3.4]/a' },
  { name: 'double opening bracket', format: 'url', address: 'http://[[::1]/a' },
  { name: 'double closing bracket', format: 'url', address: 'http://[::1]]/a' },
  { name: 'bracketed name', format: 'url', address: 'http://[example.com]/a' },
  { name: 'empty brackets', format: 'url', address: 'http://[]/a' },
  { name: 'stray closing bracket', format: 'url', address: 'http://a]b/' },
  { name: 'stray opening bracket', format: 'url', address: 'http://a[b/' },
  { name: 'bracket in the middle of a host', format: 'url', address: 'http://a[::1]/' },
  { name: 'text after the closing bracket', format: 'url', address: 'http://[::1]x/' },
  { name: 'IPv6 literal uppercase hex lowercased', format: 'url', address: 'http://[FE80::A]/a', want: 'http://[fe80::a]/a' },
  { name: 'IPv4-mapped IPv6 literal', format: 'url', address: 'http://[::ffff:1.2.3.4]/a', want: 'http://[::ffff:1.2.3.4]/a' },

  // url port
  { name: 'leading zeros on the https default port', format: 'url', address: 'https://x.com:0443/a', want: 'https://x.com/a' },
  { name: 'leading zeros on the http default port', format: 'url', address: 'http://x.com:0080/a', want: 'http://x.com/a' },
  { name: 'leading zeros stripped from another port', format: 'url', address: 'https://x.com:08443/a', want: 'https://x.com:8443/a' },
  { name: 'port 80 on https kept without zeros', format: 'url', address: 'https://x.com:0080/a', want: 'https://x.com:80/a' },
  { name: 'default port of another scheme kept', format: 'url', address: 'foo://x.com:443/a', want: 'foo://x.com:443/a' },
  { name: 'port zero kept', format: 'url', address: 'https://x.com:0/a', want: 'https://x.com:0/a' },
  { name: 'all-zero port is port zero', format: 'url', address: 'https://x.com:000/a', want: 'https://x.com:0/a' },
  { name: 'highest port', format: 'url', address: 'https://x.com:65535/a', want: 'https://x.com:65535/a' },
  { name: 'port above the highest', format: 'url', address: 'https://x.com:65536/a' },
  { name: 'port above the highest after zeros', format: 'url', address: 'https://x.com:0065536/a' },
  { name: 'very long port', format: 'url', address: 'https://x.com:99999999999999999999999/a' },
  { name: 'port too large on a non-default scheme', format: 'url', address: 'foo://x.com:70000/a' },
  { name: 'IPv6 host with a zero-padded default port', format: 'url', address: 'https://[::1]:0443/a', want: 'https://[::1]/a' },

  // text rules, every format
  { name: 'url with a NUL', format: 'url', address: 'https://x.com/a\x00b' },
  { name: 'url with a zero-width space', format: 'url', address: 'https://x.com/a\u200bb' },
  { name: 'url with a bidi override', format: 'url', address: 'https://x.com/\u202ea' },
  { name: 'url with a leading BOM', format: 'url', address: '\ufeffhttps://x.com/' },
  { name: 'url with a lone surrogate', format: 'url', address: 'https://x.com/\ud800' },
  { name: 'url with a non-ASCII path is escaped', format: 'url', address: 'https://x.com/caf\u00e9', want: 'https://x.com/caf%C3%A9' },
  { name: 'url with a non-ASCII path next to a non-ASCII host', format: 'url', address: 'https://\u00e9.example/\u4e2d', want: 'https://\u00e9.example/%E4%B8%AD' },
  { name: 'url at the length limit', format: 'url', address: `https://x.com/${'a'.repeat(1024 - 'https://x.com/'.length)}`, want: `https://x.com/${'a'.repeat(1024 - 'https://x.com/'.length)}` },
  { name: 'url over the length limit', format: 'url', address: `https://x.com/${'a'.repeat(1025 - 'https://x.com/'.length)}` },
  { name: 'url of many short dot segments over the limit', format: 'url', address: `https://x.com/${'a/../'.repeat(300)}` },
  { name: 'caip10 with a NUL', format: 'caip10', address: `eip155:1:${EVM_LOWER}\x00` },
  { name: 'caip10 with a zero-width space', format: 'caip10', address: `eip155:1:${EVM_LOWER}\u200b` },
  { name: 'caip10 over the length limit', format: 'caip10', address: 'a'.repeat(1025) },

  // caip10 chain reference
  { name: 'eip155 reference zero', format: 'caip10', address: `eip155:0:${EVM_LOWER}` },
  { name: 'eip155 reference with a leading zero', format: 'caip10', address: `eip155:01:${EVM_LOWER}` },
  { name: 'eip155 reference in hex', format: 'caip10', address: `eip155:0x1:${EVM_LOWER}` },
  { name: 'eip155 negative reference', format: 'caip10', address: `eip155:-1:${EVM_LOWER}` },
  { name: 'eip155 reference with letters', format: 'caip10', address: `eip155:abc:${EVM_LOWER}` },
  { name: 'eip155 reference with an underscore', format: 'caip10', address: `eip155:1_0:${EVM_LOWER}` },
  { name: 'eip155 reference 10', format: 'caip10', address: `eip155:10:${EVM_LOWER}`, want: `eip155:10:${EVM_LOWER}` },
  { name: 'eip155 uppercase namespace with a bad reference', format: 'caip10', address: `EIP155:01:${EVM_LOWER}` },
  { name: 'other namespaces keep a zero-led reference', format: 'caip10', address: 'cosmos:01:abc', want: 'cosmos:01:abc' },

  // opaque
  { name: 'opaque kept exactly', format: 'opaque', address: 'Escrow-1', want: 'Escrow-1' },
  { name: 'opaque with inner spaces', format: 'opaque', address: 'my escrow', want: 'my escrow' },
  { name: 'opaque empty', format: 'opaque', address: '' },
  { name: 'opaque leading space', format: 'opaque', address: ' a' },
  { name: 'opaque trailing tab', format: 'opaque', address: 'a\t' },
  { name: 'opaque with a NUL', format: 'opaque', address: 'a\x00b' },
  { name: 'opaque with an inner tab', format: 'opaque', address: 'a\tb' },
  { name: 'opaque with a newline', format: 'opaque', address: 'a\nb' },
  { name: 'opaque with DEL', format: 'opaque', address: 'a\x7fb' },
  { name: 'opaque with a C1 control', format: 'opaque', address: 'a\u0085b' },
  { name: 'opaque with a zero-width space', format: 'opaque', address: 'a\u200bb' },
  { name: 'opaque with a zero-width joiner', format: 'opaque', address: 'a\u200db' },
  { name: 'opaque with a bidi mark', format: 'opaque', address: 'a\u200eb' },
  { name: 'opaque with a soft hyphen', format: 'opaque', address: 'a\u00adb' },
  { name: 'opaque with a leading BOM', format: 'opaque', address: '\ufeffabc' },
  { name: 'opaque with a lone surrogate', format: 'opaque', address: 'a\ud800b' },
  { name: 'opaque with the replacement character', format: 'opaque', address: 'a\ufffdb', want: 'a\ufffdb' },
  { name: 'opaque non-ASCII letters', format: 'opaque', address: 'Escrow-\u00e9\u4e2d', want: 'Escrow-\u00e9\u4e2d' },
  { name: 'opaque at the length limit', format: 'opaque', address: 'a'.repeat(1024), want: 'a'.repeat(1024) },
  { name: 'opaque over the length limit', format: 'opaque', address: 'a'.repeat(1025) },
  { name: 'opaque multibyte over the byte limit', format: 'opaque', address: '\u00e9'.repeat(513) },
  { name: 'opaque multibyte at the byte limit', format: 'opaque', address: '\u00e9'.repeat(512), want: '\u00e9'.repeat(512) },
];

const canonicalCases: { name: string; format: ContractAddressFormat; address: string }[] = [
  { name: 'lowercase eip155', format: 'caip10', address: `eip155:1:${EVM_LOWER}` },
  { name: 'eip155 on a long chain id', format: 'caip10', address: `eip155:11155111:${EVM_LOWER}` },
  { name: 'solana', format: 'caip10', address: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:7S3P4HxJpyyigGzodYwHtCxZyUQe9JiBMHyRWXArAaKv' },
  { name: 'https with a path', format: 'url', address: 'https://swap.example.com/v1/swap' },
  { name: 'https root', format: 'url', address: 'https://swap.example.com/' },
  { name: 'https with a custom port and query', format: 'url', address: 'https://swap.example.com:8443/v1?a=b' },
  { name: 'http', format: 'url', address: 'http://localhost:8080/a' },
  { name: 'https IPv6 host', format: 'url', address: 'https://[::1]:8443/a' },
  { name: 'urn', format: 'url', address: 'urn:isbn:0451450523' },
  { name: 'file', format: 'url', address: 'file:///etc/hosts' },
  { name: 'opaque id', format: 'opaque', address: 'Escrow-1' },
  { name: 'opaque uuid', format: 'opaque', address: '123e4567-e89b-12d3-a456-426614174000' },
];

type EqualCase = { name: string; a: [ContractAddressFormat, string]; b: [ContractAddressFormat, string]; want: boolean };

const equalCases: EqualCase[] = [
  { name: 'two spellings of one URL', a: ['url', 'https://Swap.Example.com:443'], b: ['url', 'https://swap.example.com/'], want: true },
  { name: 'opaque part hex case', a: ['url', 'urn:example:%2f'], b: ['url', 'urn:example:%2F'], want: true },
  { name: 'opaque part unreserved escape', a: ['url', 'mailto:%41@b.com'], b: ['url', 'mailto:A@b.com'], want: true },
  { name: 'identical invalid query escape is not equal', a: ['url', 'https://x.com/?x=%zz'], b: ['url', 'https://x.com/?x=%zz'], want: false },
  { name: 'different invalid query escapes', a: ['url', 'https://x.com/?x=%zz'], b: ['url', 'https://x.com/?x=%ZZ'], want: false },
  { name: 'dot segments are not resolved', a: ['url', 'https://x.com/a/../b'], b: ['url', 'https://x.com/b'], want: false },
  { name: 'encoded dot segments equal literal ones', a: ['url', 'https://x.com/a/%2e%2e/b'], b: ['url', 'https://x.com/a/../b'], want: true },
  { name: 'encoded dot segment is not the resolved path', a: ['url', 'https://x.com/admin/%2e%2e/swap'], b: ['url', 'https://x.com/swap'], want: false },
  { name: 'zero-padded and plain default port', a: ['url', 'https://x.com:0443/a'], b: ['url', 'https://x.com:443/a'], want: true },
  { name: 'zero-padded port and no port', a: ['url', 'https://x.com:0443/a'], b: ['url', 'https://x.com/a'], want: true },
  { name: 'zero-padded and plain custom port', a: ['url', 'https://x.com:08443/a'], b: ['url', 'https://x.com:8443/a'], want: true },
  { name: 'dotted capital I host is not plain i', a: ['url', 'https://\u0130.example/'], b: ['url', 'https://i.example/'], want: false },
  { name: 'ASCII host case', a: ['url', 'https://EXAMPLE.com/'], b: ['url', 'https://example.COM/'], want: true },
  { name: 'two hosts that are not UTF-8', a: ['url', 'https://%C3/'], b: ['url', 'https://%FF/'], want: false },
  { name: 'host with an encoded byte order mark is not the plain host', a: ['url', 'https://%EF%BB%BFgate.example/'], b: ['url', 'https://gate.example/'], want: false },
  { name: 'chain reference with a leading zero', a: ['caip10', `eip155:01:${EVM_LOWER}`], b: ['caip10', `eip155:1:${EVM_LOWER}`], want: false },
  { name: 'identical opaque with a NUL', a: ['opaque', 'a\x00b'], b: ['opaque', 'a\x00b'], want: false },
  { name: 'opaque with and without a zero-width space', a: ['opaque', 'a\u200bb'], b: ['opaque', 'ab'], want: false },
  { name: 'identical opaque over the length limit', a: ['opaque', 'a'.repeat(1025)], b: ['opaque', 'a'.repeat(1025)], want: false },
  { name: 'trailing slash on a path differs', a: ['url', 'https://x.com/v1'], b: ['url', 'https://x.com/v1/'], want: false },
  { name: 'eip155 checksum and lowercase', a: ['caip10', `eip155:1:${EVM_CHECKSUM}`], b: ['caip10', `eip155:1:${EVM_LOWER}`], want: true },
  { name: 'same eip155 address on another chain', a: ['caip10', `eip155:1:${EVM_LOWER}`], b: ['caip10', `eip155:137:${EVM_LOWER}`], want: false },
  { name: 'opaque compares letter case', a: ['opaque', 'escrow-1'], b: ['opaque', 'Escrow-1'], want: false },
  { name: 'opaque identical', a: ['opaque', 'escrow-1'], b: ['opaque', 'escrow-1'], want: true },
  { name: 'same text, different formats', a: ['opaque', `eip155:1:${EVM_LOWER}`], b: ['caip10', `eip155:1:${EVM_LOWER}`], want: false },
  { name: 'identical invalid addresses are not equal', a: ['url', 'www.x.com'], b: ['url', 'www.x.com'], want: false },
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

  test.each(canonicalCases)('canonical form unchanged: $name', ({ format, address }) => {
    expect(impl.normalizeContractAddress(address, format)).toBe(address);
  });

  test.each(normalizeCases)('equal agrees with normalize: $name', ({ format, address, want }) => {
    const same = impl.sameContract({ address, addressFormat: format }, { address, addressFormat: format });

    expect(same).toBe(want !== undefined);
    if (want !== undefined) {
      expect(impl.sameContract({ address, addressFormat: format }, { address: want, addressFormat: format })).toBe(true);
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

describe('respell and unlisted helpers', () => {
  test.each([
    { name: 'url host with a non-ASCII letter keeps it', address: 'https://straße.example/a', want: 'HTTPS://STRAßE.EXAMPLE:443/a' },
    { name: 'url host is uppercased', address: 'http://x.com/a', want: 'HTTP://X.COM:80/a' },
  ])('respell: $name', ({ address, want }) => {
    const got = suite.respellContractAddress(address, 'url');

    expect(got).toBe(want);
    expect(suite.sameContract({ address: got, addressFormat: 'url' }, { address, addressFormat: 'url' })).toBe(true);
  });

  test.each([
    { name: 'caip10 eip155', format: 'caip10' as const, address: `eip155:137:${EVM_LOWER}`, prefix: 'eip155:137:0x' },
    { name: 'caip10 other namespace', format: 'caip10' as const, address: 'cosmos:Cosmoshub-4:abc', prefix: 'cosmos:Cosmoshub-4:not-listed-' },
    { name: 'url', format: 'url' as const, address: 'https://gate.example/a', prefix: 'https://not-listed-' },
    { name: 'opaque', format: 'opaque' as const, address: 'escrow-1', prefix: 'not-listed-' },
  ])('unlisted: $name', ({ format, address, prefix }) => {
    const listed = { address, addressFormat: format };

    const got = suite.unlistedContractAddress(listed, '123');

    expect(got.startsWith(prefix)).toBe(true);
    expect(suite.isValidContractAddress(got, format)).toBe(true);
    expect(suite.sameContract({ address: got, addressFormat: format }, listed)).toBe(false);
  });
});

describe('exact decimal limit checks', () => {
  test.each([
    { name: 'equal integers', a: '10', b: '10', want: 0 },
    { name: 'trailing zeros ignored', a: '10.50', b: '10.5', want: 0 },
    { name: 'leading zeros ignored', a: '007', b: '7', want: 0 },
    { name: 'a digit past double precision', a: '10', b: '10.000000000000000001', want: -1 },
    { name: 'a digit past double precision, reversed', a: '10.000000000000000001', b: '10', want: 1 },
    { name: 'just below the amount', a: '10', b: '9.999999999999999999', want: 1 },
    { name: 'more whole digits is larger', a: '100', b: '99.99', want: 1 },
    { name: 'integers beyond 2^53', a: '9007199254740993', b: '9007199254740992', want: 1 },
    { name: 'zero against a fraction', a: '0', b: '0.0000000000000000001', want: -1 },
  ])('compare: $name', ({ a, b, want }) => {
    expect(decimal.compareDecimals(a, b)).toBe(want);
  });

  test.each([
    { name: 'no limits', limits: undefined, want: true },
    { name: 'min equal to the amount', limits: { minAmount: '10' }, want: true },
    { name: 'min a hair above the amount', limits: { minAmount: '10.000000000000000001' }, want: false },
    { name: 'max a hair below the amount', limits: { maxAmount: '9.999999999999999999' }, want: false },
    { name: 'max a hair above the amount', limits: { maxAmount: '10.000000000000000001' }, want: true },
    { name: 'max equal to the amount', limits: { maxAmount: '10.0' }, want: true },
    { name: 'inside both limits', limits: { minAmount: '1', maxAmount: '100' }, want: true },
    { name: 'outside both limits', limits: { minAmount: '11', maxAmount: '100' }, want: false },
  ])('amount 10 within limits: $name', ({ limits, want }) => {
    expect(decimal.amountWithinLimits('10', limits)).toBe(want);
  });

  test('a value that is not a decimal throws', () => {
    expect(() => decimal.compareDecimals('1e3', '1')).toThrow(/decimal/);
  });
});

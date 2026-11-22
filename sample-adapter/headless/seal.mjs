#!/usr/bin/env node
// node seal.mjs <adapter-base-url> FIELD=value [FIELD=value...]
// Fetches <url>/config, seals every value with descriptor.encryption and prints
// { values: { FIELD: <SealedValue> } } ready to POST to <url>/config/apply.
import { importAdapterKey, sealSecret } from './seal-lib.mjs';

const usage = 'usage: node seal.mjs <adapter-base-url> FIELD=value [FIELD=value...]';

function fail(msg) {
  process.stderr.write(`${msg}\n`);
  process.exit(1);
}

const [baseUrl, ...pairs] = process.argv.slice(2);
if (!baseUrl || pairs.length === 0) fail(usage);

const entries = pairs.map((p) => {
  const i = p.indexOf('=');
  if (i <= 0) fail(`bad argument "${p.split('=')[0]}": expected FIELD=value`);
  return [p.slice(0, i), p.slice(i + 1)];
});

const url = `${baseUrl.replace(/\/+$/, '')}/config`;
let descriptor;
try {
  const res = await fetch(url);
  if (!res.ok) fail(`GET ${url} -> ${res.status}`);
  descriptor = await res.json();
} catch (e) {
  fail(`GET ${url} failed: ${e.message}`);
}

if (!descriptor.encryption) fail('adapter publishes no encryption info (descriptor.encryption absent); it accepts plaintext only');

const rsaKey = await importAdapterKey(descriptor.encryption);
const values = {};
for (const [field, value] of entries) {
  // eslint-disable-next-line no-await-in-loop
  values[field] = await sealSecret(descriptor.encryption, value, rsaKey);
}
process.stdout.write(`${JSON.stringify({ values }, null, 2)}\n`);

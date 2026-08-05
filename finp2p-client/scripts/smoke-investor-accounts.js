/**
 * Wire-level smoke test for the investor network-account onboarding surface.
 *
 * This package has no test harness, and the onboarding methods are thin
 * wrappers whose interesting behaviour is what actually goes on the wire —
 * request path, the required Idempotency-Key header, and how the OSS
 * NetworkAccount union is discriminated. Typechecking cannot catch a wrong
 * path or a missing header, so assert them against throwaway local servers.
 *
 *   node scripts/smoke-investor-accounts.js     (run `npm run build` first)
 *
 * Exits non-zero on the first failed assertion.
 */
const http = require('http');
const path = require('path');
const assert = require('node:assert/strict');

const dist = path.join(__dirname, '..', 'dist');
const { FinAPIClient } = require(path.join(dist, 'finapi'));
const { OssClient } = require(path.join(dist, 'oss'));

const INVESTOR = 'bank-x:101:511c1d7f-4ed8-410d-887c-a10e3e499a01';

/** Start a server that records requests and replies with `reply`. Resolves to { port, seen, close }. */
function recordingServer(reply) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seen.push({
        method: req.method,
        url: req.url,
        idempotencyKey: req.headers['idempotency-key'],
        body: body ? JSON.parse(body) : null,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(reply));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, () => resolve({
      port: server.address().port,
      seen,
      close: () => server.close(),
    }));
  });
}

async function checkRestSurface() {
  const srv = await recordingServer({ cid: 'cid-123', isCompleted: false });
  const client = new FinAPIClient(`http://127.0.0.1:${srv.port}`);

  await client.createInvestorAccount(INVESTOR, { organizationId: 'bank-x', assetId: 'asset-1' });
  await client.bindInvestorAccount(INVESTOR, {
    organizationId: 'bank-x',
    assetId: 'asset-1',
    networkAccount: { type: 'caip10Account', network: 'eip155:1', address: '0xabc' },
    ownershipSignature: 'deadbeef',
  });
  await client.submitAccountProof(INVESTOR, { cid: 'cid-123', ownershipSignature: 'cafe' });
  await client.removeInvestorAccount(INVESTOR, 'acct-7', 'explicit-key-abc');
  srv.close();

  const [create, bind, proof, remove] = srv.seen;
  const encoded = encodeURIComponent(INVESTOR);

  assert.equal(srv.seen.length, 4, 'expected four requests');

  assert.equal(create.method, 'POST');
  assert.equal(create.url, `/profiles/investor/${encoded}/account/create`);
  assert.deepEqual(create.body, { organizationId: 'bank-x', assetId: 'asset-1' });

  assert.equal(bind.method, 'POST');
  assert.equal(bind.url, `/profiles/investor/${encoded}/account/bind`);
  assert.equal(bind.body.networkAccount.type, 'caip10Account');
  assert.equal(bind.body.ownershipSignature, 'deadbeef');

  assert.equal(proof.method, 'POST');
  assert.equal(proof.url, `/profiles/investor/${encoded}/account/proof`);
  assert.deepEqual(proof.body, { cid: 'cid-123', ownershipSignature: 'cafe' });

  assert.equal(remove.method, 'DELETE');
  assert.equal(remove.url, `/profiles/investor/${encoded}/account/acct-7`);

  // Idempotency-Key is required on all four routes.
  const keys = srv.seen.map((s) => s.idempotencyKey);
  assert.ok(keys.every(Boolean), 'every request must carry Idempotency-Key');
  const auto = keys.slice(0, 3);
  assert.ok(auto.every((k) => /^[0-9a-f]{64}$/.test(k)), 'auto keys must be 32-byte hex');
  assert.equal(new Set(auto).size, 3, 'auto keys must differ per call');
  assert.equal(keys[3], 'explicit-key-abc', 'explicit key must be honored');

  console.log('  ok  REST: 4 routes, bodies, required Idempotency-Key, explicit override');
}

async function checkOssReadBack() {
  const accounts = [
    {
      organizationId: 'bank-x', assetId: 'asset-1', id: 'acct-1',
      account: { kind: 'WalletAccount', type: 'walletAccount', address: '0xaaa' },
    },
    {
      organizationId: 'bank-x', assetId: 'asset-2', id: 'acct-2',
      account: { kind: 'Caip10Account', network: 'eip155:1', address: '0xbbb' },
    },
    {
      organizationId: 'bank-y', assetId: 'asset-1', id: 'acct-3',
      account: { kind: 'CustodialAccount', provider: 'fireblocks', vaultAccountId: 'v7', assetId: null },
    },
  ];
  const srv = await recordingServer({
    data: {
      users: {
        nodes: [{
          id: INVESTOR, name: 'Inv', finIds: ['abc'], organizationId: 'bank-x',
          metadata: { acl: [] }, networkAccounts: accounts,
        }],
      },
    },
  });
  const client = new OssClient(`http://127.0.0.1:${srv.port}`);

  const all = await client.getOwnerNetworkAccounts(INVESTOR);
  const byAsset = await client.getOwnerNetworkAccounts(INVESTOR, { assetId: 'asset-1' });
  const scoped = await client.getOwnerNetworkAccounts(INVESTOR, { organizationId: 'bank-x', assetId: 'asset-1' });
  srv.close();

  const vars = srv.seen[0].body.variables;
  assert.equal(vars.includeNetworkAccounts, true, 'must opt into networkAccounts');
  assert.equal(vars.includeCerts, false);
  assert.equal(vars.includeHoldings, false);

  // The union must be selected via inline fragments, never as an object field.
  const query = srv.seen[0].body.query;
  assert.ok(/networkAccounts/.test(query), 'query must select networkAccounts');
  assert.ok(/\.\.\. on WalletAccount/.test(query), 'must use an inline fragment on WalletAccount');
  assert.ok(!/networkAccount\s*{\s*wallet/.test(query), 'must not select `wallet` on the union');

  assert.deepEqual(all.map((a) => a.id), ['acct-1', 'acct-2', 'acct-3']);
  assert.deepEqual(
    all.map((a) => a.account.kind),
    ['WalletAccount', 'Caip10Account', 'CustodialAccount'],
    'all three union variants must round-trip',
  );
  assert.deepEqual(byAsset.map((a) => a.id), ['acct-1', 'acct-3'], 'assetId scope');
  assert.deepEqual(scoped.map((a) => a.id), ['acct-1'], 'organizationId + assetId scope');

  console.log('  ok  OSS: query variables, union discrimination, scope filtering');
}

async function checkOssNotFound() {
  const srv = await recordingServer({ data: { users: { nodes: [] } } });
  const client = new OssClient(`http://127.0.0.1:${srv.port}`);
  await assert.rejects(
    () => client.getOwnerNetworkAccounts('missing'),
    (e) => e.constructor.name === 'ItemNotFoundError',
    'unknown owner must raise ItemNotFoundError',
  );
  srv.close();
  console.log('  ok  OSS: unknown owner raises ItemNotFoundError');
}

(async () => {
  console.log('investor network-account smoke test');
  await checkRestSurface();
  await checkOssReadBack();
  await checkOssNotFound();
  console.log('all assertions passed');
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});

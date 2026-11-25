/**
 * Wire-level smoke test for the repo agreement surface.
 *
 * This package has no test harness, and the repo methods are thin wrappers
 * whose interesting behaviour is what actually goes on the wire — the route,
 * how an id is encoded into a path segment, the Idempotency-Key, and how the
 * OSS read model's base64 terms come back. Typechecking cannot catch a wrong
 * path, and a wrong path here addresses someone else's agreement.
 *
 *   node scripts/smoke-repo-agreements.js     (run `npm run build` first)
 *
 * Exits non-zero on the first failed assertion.
 */
const http = require('http');
const path = require('path');
const assert = require('node:assert/strict');

const dist = path.join(__dirname, '..', 'dist');
const { RepoAgreementsClient, pathSegment, RepoApiError } = require(path.join(dist, 'repo'));
const { OssClient, decodeAgreementTerms } = require(path.join(dist, 'oss'));

const AGREEMENT = 'bank-x:107:3f1a';
const BORROWER = 'bank-x:101:borrower';
const LENDER = 'bank-y:101:lender';

/** Start a server that records requests and replies with `reply`. */
function recordingServer(reply, status = 200) {
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
      res.writeHead(status, { 'Content-Type': 'application/json' });
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

function checkPathSegment() {
  // `:` stays literal — every finp2p id contains one and the router's routes expect it.
  assert.equal(pathSegment('bank-x:107:3f1a'), 'bank-x:107:3f1a');
  assert.equal(pathSegment('a b'), 'a%20b', 'space must encode as %20, never +');

  // Ids that would change the route are refused rather than escaped.
  for (const bad of ['', '.', '..', 'a/b', 'a\\b', 'a%2Fb']) {
    assert.throws(() => pathSegment(bad), /Invalid id for a URL path segment/, `must refuse ${JSON.stringify(bad)}`);
  }
  console.log('  ok  pathSegment: colon literal, space as %20, traversal refused');
}

async function checkLifecycleRoutes() {
  const srv = await recordingServer({ agreementId: AGREEMENT, status: 'ok', eventId: 'e1', sequence: 1 });
  const client = new RepoAgreementsClient(`http://127.0.0.1:${srv.port}`);

  await client.proposeAgreement({
    parties: { pledger: { orgId: 'bank-x' }, receiver: { orgId: 'bank-y' } },
    terms: { borrower: BORROWER, lender: LENDER, eligibleAssets: [{ assetId: 'WTGXX', haircut: '0.02' }] },
    consentRoles: ['pledger', 'receiver'],
  });
  await client.approveAgreement(AGREEMENT, { role: 'receiver', agreementVersion: 1 });
  await client.rejectAgreement(AGREEMENT, { role: 'receiver', reason: 'terms' });
  await client.terminate(AGREEMENT, { role: 'pledger' }, 'explicit-key-abc');
  srv.close();

  const [propose, approve, reject, terminate] = srv.seen;

  assert.equal(srv.seen.length, 4, 'expected four requests');
  assert.ok(srv.seen.every((s) => s.method === 'POST'), 'every repo command is a POST');

  assert.equal(propose.url, '/repo/agreements');
  assert.deepEqual(propose.body.parties, { pledger: { orgId: 'bank-x' }, receiver: { orgId: 'bank-y' } });
  assert.deepEqual(propose.body.consentRoles, ['pledger', 'receiver']);
  assert.equal(propose.body.terms.eligibleAssets[0].assetId, 'WTGXX',
    'terms must go on the wire as an object, not a string');
  assert.ok(!('termsType' in propose.body), 'termsType must be omitted when not given');

  assert.equal(approve.url, `/repo/agreements/${AGREEMENT}/approve`);
  assert.deepEqual(approve.body, { role: 'receiver', agreementVersion: 1 });

  // reject carries a reason, NOT an agreementVersion — it is not the approve body.
  assert.equal(reject.url, `/repo/agreements/${AGREEMENT}/reject`);
  assert.deepEqual(reject.body, { role: 'receiver', reason: 'terms' });

  assert.equal(terminate.url, `/repo/agreements/${AGREEMENT}/termination`);

  const keys = srv.seen.map((s) => s.idempotencyKey);
  assert.ok(keys.every(Boolean), 'every repo command must carry Idempotency-Key');
  const auto = keys.slice(0, 3);
  assert.ok(auto.every((k) => /^[0-9a-f]{64}$/.test(k)), 'auto keys must be 32-byte hex');
  assert.equal(new Set(auto).size, 3, 'auto keys must differ per call');
  assert.equal(keys[3], 'explicit-key-abc', 'explicit key must be honored');

  console.log('  ok  lifecycle: 4 routes, reject body differs from approve, Idempotency-Key');
}

async function checkCommandRoutes() {
  const srv = await recordingServer({ eventId: 'e1', sequence: 2 });
  const client = new RepoAgreementsClient(`http://127.0.0.1:${srv.port}`);

  await client.openTrade(AGREEMENT, { role: 'venue', payload: { amount: '40' } });
  await client.settleTrade(AGREEMENT, 'trade-1', { role: 'pledger' });
  await client.proposeLines(AGREEMENT, 'report-9', { role: 'calculation-agent' });
  await client.approveLines(AGREEMENT, 'proposal-4', { role: 'approver' });
  await client.closeBasket(AGREEMENT, 'basket-2', { role: 'receiver' });
  srv.close();

  const urls = srv.seen.map((s) => s.url);
  assert.deepEqual(urls, [
    `/repo/agreements/${AGREEMENT}/trades`,
    `/repo/agreements/${AGREEMENT}/trades/trade-1/settle`,
    `/repo/agreements/${AGREEMENT}/reports/report-9/lines`,
    // The `_` is literal: the facade reads the proposal off the log by its event id.
    `/repo/agreements/${AGREEMENT}/reports/_/proposals/proposal-4/approve`,
    `/repo/agreements/${AGREEMENT}/baskets/basket-2/close`,
  ]);
  assert.equal(srv.seen[0].body.payload.amount, '40');
  assert.equal(srv.seen[1].body.role, 'pledger');
  assert.equal(srv.seen[3].body.role, 'approver');

  console.log('  ok  commands: trade, report, proposal (literal `_`) and basket routes');
}

async function checkErrorMapping() {
  const srv = await recordingServer({ error: 'nope' }, 409);
  const client = new RepoAgreementsClient(`http://127.0.0.1:${srv.port}`);
  await assert.rejects(
    () => client.approveAgreement(AGREEMENT, { role: 'receiver', agreementVersion: 1 }),
    (e) => e instanceof RepoApiError && e.status === 409 && e.body.error === 'nope',
    'a non-2xx must raise RepoApiError carrying status and body',
  );
  srv.close();
  console.log('  ok  transport: non-2xx raises RepoApiError with status and body');
}

function agreementNode(overrides) {
  return {
    id: AGREEMENT,
    organizationId: 'bank-x',
    status: 'AGREEMENT_STATUS_ACTIVE',
    businessState: '',
    version: 1,
    consentRoles: ['pledger', 'receiver'],
    participants: [],
    roles: [
      { role: 'pledger', parties: [BORROWER] },
      { role: 'receiver', parties: [LENDER] },
    ],
    eligibleAssets: [],
    termsType: 'repo-terms/v1',
    terms: Buffer.from(JSON.stringify({ cashAssetId: 'USD', haircutConvention: 'divide' })).toString('base64'),
    validFrom: 1, validUntil: 2, signatures: [], rejections: [],
    createdAt: 10, updatedAt: 11,
    ...overrides,
  };
}

async function checkOssReadBack() {
  // Binds the borrower but NOT the lender: a half-match, so an `||` where the
  // code means `&&` would wrongly return it.
  const other = agreementNode({
    id: 'bank-x:107:other',
    roles: [
      { role: 'pledger', parties: [BORROWER] },
      { role: 'receiver', parties: ['someone-else'] },
    ],
  });
  const srv = await recordingServer({ data: { agreements: { nodes: [agreementNode({}), other] } } });
  const client = new OssClient(`http://127.0.0.1:${srv.port}`);

  const all = await client.getAgreements();
  const between = await client.findActiveAgreementsBetween(BORROWER, LENDER, { termsType: 'repo-terms/v1' });
  srv.close();

  const query = srv.seen[0].body.query;
  assert.ok(/agreements\(/.test(query), 'must query the top-level `agreements` field');
  assert.ok(!/repo\s*{/.test(query), '`repo` is a terms vocabulary, not a GraphQL namespace');

  // Only status and termsType go server-side; the party match is client-side.
  const vars = srv.seen[1].body.variables;
  assert.deepEqual(vars.filter, [
    { key: 'status', operator: 'EQ', value: 'AGREEMENT_STATUS_ACTIVE' },
    { key: 'termsType', operator: 'EQ', value: 'repo-terms/v1' },
  ], 'only top-level fields may be filtered server-side');
  assert.deepEqual(vars.orderBy, { field: 'CREATED_AT', direction: 'DESC' });

  assert.equal(all.length, 2, 'getAgreements returns every row');
  assert.deepEqual(between.map((a) => a.id), [AGREEMENT],
    'only the agreement binding BOTH parties matches');

  const terms = decodeAgreementTerms(all[0]);
  assert.deepEqual(terms, { cashAssetId: 'USD', haircutConvention: 'divide' },
    'base64 terms must decode to the application payload');

  console.log('  ok  OSS: top-level query, server/client filter split, terms decoded');
}

async function checkTermsDecodeIsTotal() {
  // Terms are written by whichever application owns termsType. A payload this
  // client cannot parse is a fact about the agreement, not a crash: a lookup
  // scanning many agreements must not die on one bad row.
  assert.equal(decodeAgreementTerms({ terms: '' }), undefined, 'empty terms');
  assert.equal(decodeAgreementTerms({ terms: 'not!base64!' }), undefined, 'unparseable terms');
  assert.equal(decodeAgreementTerms({ terms: Buffer.from('not json').toString('base64') }), undefined, 'non-JSON terms');
  console.log('  ok  decodeAgreementTerms: returns undefined rather than throwing');
}

(async () => {
  console.log('repo agreement smoke test');
  checkPathSegment();
  await checkLifecycleRoutes();
  await checkCommandRoutes();
  await checkErrorMapping();
  await checkOssReadBack();
  await checkTermsDecodeIsTotal();
  console.log('all assertions passed');
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});

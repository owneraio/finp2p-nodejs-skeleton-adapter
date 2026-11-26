/**
 * Wire-level smoke test for the move intent helpers.
 *
 * This package has no test harness, and these helpers are thin shapers: the
 * only interesting behaviour is the exact JSON that reaches the node. The node
 * rejects a malformed move intent with a generic validation error, so a wrong
 * field name here costs a round trip to a deployed router to find. Typechecking
 * does not help, because the generated types make most of the body optional.
 *
 *   node scripts/smoke-move-intents.js     (run `npm run build` first)
 *
 * Exits non-zero on the first failed assertion.
 */
const http = require('http');
const path = require('path');
const assert = require('node:assert/strict');

const dist = path.join(__dirname, '..', 'dist');
const { FinP2PClient } = require(path.join(dist, 'client'));
const {
  createMoveIntent, executeMoveIntent, createMovePolicy, MOVE_SOURCE_ASSET_PATH,
} = require(path.join(dist, 'flows'));

const SRC = {
  id: 'bank-x:102:dtcc-classic',
  ledgerIdentifier: {
    assetIdentifierType: 'CAIP-19', network: 'dtcc', standard: 'DTCC_CLASSIC', tokenId: 'MCKUSTB4W',
  },
};
const DST = {
  id: 'bank-y:102:ustb4w-erc20',
  ledgerIdentifier: {
    assetIdentifierType: 'CAIP-19', network: 'eip155:11155111', standard: 'ERC20', tokenId: '0x3ff8',
  },
};
const OWNER = { id: 'bank-x:101:alice', finId: '02aa'.padEnd(66, '0'), custodianOrgId: 'custodian-org' };

/** Start a server that records requests and replies with `reply`. */
function recordingServer(reply, status = 200) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, body: body ? JSON.parse(body) : null });
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(reply));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, () => resolve({
      port: server.address().port, seen, close: () => server.close(),
    }));
  });
}

async function checkCreateMoveIntent() {
  const srv = await recordingServer({ id: 'bank-x:106:move-intent' });
  try {
    const url = `http://127.0.0.1:${srv.port}`;
    const client = new FinP2PClient(url, url);
    const id = await createMoveIntent(client, { sourceAsset: SRC, destinationAssets: [DST] });
    assert.equal(id, 'bank-x:106:move-intent');

    const [req] = srv.seen;
    // The intent hangs off the SOURCE asset, not the destination. openapi-fetch
    // percent-encodes the `:` in a path param, as it does for every other intent
    // helper here, so the colons arrive as %3A and the node decodes them.
    assert.equal(req.url, `/profiles/asset/${encodeURIComponent(SRC.id)}/intent`,
      `posted to ${req.url}`);
    assert.equal(req.body.intent.type, 'moveIntent');
    assert.equal(req.body.intent.asset.sourceAsset.id, SRC.id);
    assert.deepEqual(req.body.intent.asset.sourceAsset.ledgerIdentifier, SRC.ledgerIdentifier);
    assert.equal(req.body.intent.asset.destinationAssets.length, 1);
    assert.equal(req.body.intent.asset.destinationAssets[0].id, DST.id);
    // The destination carries its OWN ledgerIdentifier. A move crosses tokens,
    // so borrowing the source's would describe an ERC20 as a DTCC_CLASSIC.
    assert.deepEqual(req.body.intent.asset.destinationAssets[0].ledgerIdentifier, DST.ledgerIdentifier);
    assert.deepEqual(req.body.intent.signaturePolicy, { type: 'manualPolicy' });
    assert.equal(typeof req.body.start, 'number');
    assert.ok(req.body.end > req.body.start, 'intent window must be non-empty');
    // Optional pool fields stay off the wire when not asked for.
    assert.ok(!('sourceToSegregatedAccount' in req.body.intent.asset), 'no empty segregated account');
    assert.ok(!('fromSegregatedAccount' in req.body.intent.asset.destinationAssets[0]), 'no empty pool');
    console.log('  ok  createMoveIntent: posts moveIntent on the source asset');
  } finally { srv.close(); }
}

async function checkCreateMoveIntentRejectsNoDestination() {
  const srv = await recordingServer({ id: 'x' });
  try {
    const url = `http://127.0.0.1:${srv.port}`;
    const client = new FinP2PClient(url, url);
    await assert.rejects(
      () => createMoveIntent(client, { sourceAsset: SRC, destinationAssets: [] }),
      /at least one destination/,
    );
    // Refused locally: an empty path is a caller bug, not a node round trip.
    assert.equal(srv.seen.length, 0, 'must not reach the node');
    console.log('  ok  createMoveIntent: refuses an empty destination list before calling');
  } finally { srv.close(); }
}

async function checkExecuteMoveIntent() {
  const srv = await recordingServer({ executionPlanId: 'bank-x:105:plan' });
  try {
    const url = `http://127.0.0.1:${srv.port}`;
    const client = new FinP2PClient(url, url);
    const planId = await executeMoveIntent(client, {
      intentId: 'bank-x:106:move-intent', executionId: 'exec-1', owner: OWNER,
      sourceAsset: SRC, destinationAsset: DST, amount: 100,
    });
    assert.equal(planId, 'bank-x:105:plan');

    const { instruction, term, ...rest } = srv.seen[0].body.intent.asset;
    assert.deepEqual(rest, {}, 'asset carries only term and instruction');
    assert.deepEqual(term, { amount: '100' }, 'amount is stringified');
    assert.equal(srv.seen[0].body.intent.type, 'moveIntentExecution');
    assert.equal(srv.seen[0].body.intent.owner, OWNER.id);
    assert.equal(srv.seen[0].body.user, OWNER.id);
    // 32 bytes: 24 random + 8-byte big-endian epoch seconds, per the `nonce`
    // schema. The 16-byte `hexNonce()` its neighbours use does not satisfy it.
    const nonce = srv.seen[0].body.intent.nonce;
    assert.match(nonce, /^[0-9a-f]{64}$/, 'nonce is 32 bytes of hex');
    const stamp = Number(Buffer.from(nonce, 'hex').readBigInt64BE(24));
    const now = Math.floor(Date.now() / 1000);
    assert.ok(Math.abs(now - stamp) < 120, `nonce tail must be epoch seconds, got ${stamp}`);

    // Same holder on both sides: a move converts a position, it does not move it
    // between parties, and the node rejects an execution whose finIds differ.
    assert.equal(instruction.sourceAccount.account.finId, OWNER.finId);
    assert.equal(instruction.destinationAccount.account.finId, OWNER.finId);
    // Each leg's account org comes from ITS OWN asset id, which is what a
    // cross-org conversion needs.
    assert.equal(instruction.sourceAccount.account.orgId, 'bank-x');
    assert.equal(instruction.destinationAccount.account.orgId, 'bank-y');
    assert.equal(instruction.sourceAccount.asset.id, SRC.id);
    assert.equal(instruction.destinationAccount.asset.id, DST.id);
    assert.deepEqual(instruction.destinationAccount.asset.ledgerIdentifier, DST.ledgerIdentifier);
    console.log('  ok  executeMoveIntent: same finId both sides, per-asset org');
  } finally { srv.close(); }
}

async function checkExecuteMoveIntentWholePosition() {
  const srv = await recordingServer({ executionPlanId: 'p' });
  try {
    const url = `http://127.0.0.1:${srv.port}`;
    const client = new FinP2PClient(url, url);
    await executeMoveIntent(client, {
      intentId: 'i', executionId: 'e', owner: OWNER, sourceAsset: SRC, destinationAsset: DST,
    });
    // No amount means the whole position. The term must be ABSENT, not an
    // empty object and certainly not { amount: "undefined" }.
    assert.ok(!('term' in srv.seen[0].body.intent.asset), 'term must be omitted entirely');
    console.log('  ok  executeMoveIntent: omits term when no amount is given');
  } finally { srv.close(); }
}

async function checkOrgIdOverride() {
  const srv = await recordingServer({ executionPlanId: 'p' });
  try {
    const url = `http://127.0.0.1:${srv.port}`;
    const client = new FinP2PClient(url, url);
    await executeMoveIntent(client, {
      intentId: 'i', executionId: 'e', owner: OWNER, sourceAsset: SRC, destinationAsset: DST,
      orgId: 'override-org',
    });
    const { instruction } = srv.seen[0].body.intent.asset;
    assert.equal(instruction.sourceAccount.account.orgId, 'override-org');
    assert.equal(instruction.destinationAccount.account.orgId, 'override-org');
    console.log('  ok  executeMoveIntent: orgId overrides both legs');
  } finally { srv.close(); }
}

async function checkCreateMovePolicy() {
  const srv = await recordingServer({ policyId: 'move-single' });
  try {
    const url = `http://127.0.0.1:${srv.port}`;
    const client = new FinP2PClient(url, url);
    await createMovePolicy(client, { policyId: 'move-single', priority: 5000 });

    const { body } = srv.seen[0];
    assert.equal(body.intent, 'moveIntent');
    assert.deepEqual(body.settlementStrategy, ['NOSETTLEMENT']);
    assert.equal(body.instructions.length, 1, 'one Move, not hold-issue-redeem');
    assert.equal(body.priority, 5000, 'priority is passed through, never defaulted');

    // The default instruction is asserted WHOLE, not field by field. A node
    // rejected this body twice for things no partial assertion was looking at:
    // an `executors` alongside `target` (1300), and a missing `target.version`.
    // Pinning the entire object is the only form that catches the next one.
    assert.deepEqual(body.instructions[0], {
      instruction: 'Move',
      sequence: 1,
      target: { version: 'v1', selectors: [{ type: 'asset', path: MOVE_SOURCE_ASSET_PATH }] },
      onSuccess: { type: 'status', status: 'completed' },
      onFailure: { type: 'status', status: 'failed' },
    });
    assert.ok(!('executors' in body.instructions[0]),
      'an instruction with both target and executors is refused with 1300');
    assert.deepEqual(body.instructions[0].target.selectors, [
      { type: 'asset', path: MOVE_SOURCE_ASSET_PATH },
    ]);
    // Getting this path wrong produces a policy that attaches but never
    // matches, which presents as a missing policy.
    assert.equal(MOVE_SOURCE_ASSET_PATH,
      'contract_details.move.asset.asset_instruction.source_account.finp2p_account.asset');
    console.log('  ok  createMovePolicy: single Move, NOSETTLEMENT, correct selector');
  } finally { srv.close(); }
}

async function checkCreateMovePolicyInstructionsOverride() {
  const srv = await recordingServer({ policyId: 'p' });
  try {
    const url = `http://127.0.0.1:${srv.port}`;
    const client = new FinP2PClient(url, url);
    const custom = [{ instruction: 'Move', sequence: 1, onSuccess: { type: 'status', status: 'approved' } }];
    await createMovePolicy(client, { policyId: 'p', priority: 4000, instructions: custom });
    // The transition graph is the one part of this body that is inferred rather
    // than confirmed, so the escape hatch has to actually replace it.
    assert.deepEqual(srv.seen[0].body.instructions, custom);
    console.log('  ok  createMovePolicy: instructions override replaces the default graph');
  } finally { srv.close(); }
}

async function checkPolicyErrorSurfaces() {
  const srv = await recordingServer({ errors: [{ code: 1002, message: 'Invalid request format' }] }, 400);
  try {
    const url = `http://127.0.0.1:${srv.port}`;
    const client = new FinP2PClient(url, url);
    await assert.rejects(() => createMovePolicy(client, { policyId: 'p', priority: 4000 }), /1002/);
    console.log('  ok  createMovePolicy: a rejected policy throws rather than resolving');
  } finally { srv.close(); }
}

async function checkPolicyPriorityIsNeverDefaulted() {
  const srv = await recordingServer({ policyId: 'p' });
  try {
    const url = `http://127.0.0.1:${srv.port}`;
    const client = new FinP2PClient(url, url);
    // Priority must be unique per intent on a node (4101 on a duplicate), so a
    // fixed default would work exactly once per node and then fail. Whatever
    // the caller passes must arrive untouched, including a value this helper
    // might be tempted to think too low.
    for (const priority of [1, 1001, 999999]) {
      srv.seen.length = 0;
      await createMovePolicy(client, { policyId: `p-${priority}`, priority });
      assert.equal(srv.seen[0].body.priority, priority, `priority ${priority} passed through`);
    }
    // A JS caller cannot see the type, so omitting priority must fail loudly
    // here rather than silently reuse a value that collides on the node.
    srv.seen.length = 0;
    await assert.rejects(() => createMovePolicy(client, { policyId: 'no-prio' }), /requires a numeric `priority`/);
    assert.equal(srv.seen.length, 0, 'must not reach the node without a priority');
    console.log('  ok  createMovePolicy: priority is passed through, never defaulted or clamped');
  } finally { srv.close(); }
}

(async () => {
  console.log('move intent smoke test');
  await checkCreateMoveIntent();
  await checkCreateMoveIntentRejectsNoDestination();
  await checkExecuteMoveIntent();
  await checkExecuteMoveIntentWholePosition();
  await checkOrgIdOverride();
  await checkCreateMovePolicy();
  await checkCreateMovePolicyInstructionsOverride();
  await checkPolicyPriorityIsNeverDefaulted();
  await checkPolicyErrorSurfaces();
  console.log('all assertions passed');
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});

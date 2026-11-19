# skeleton

> `@owneraio/finp2p-nodejs-skeleton-adapter` &mdash; Published to **GitHub Packages**

## Purpose

The skeleton is the **main framework** for building FinP2P ledger adapters in Node.js. It provides everything except the ledger-specific logic: HTTP route handlers, request/response mapping, async workflow persistence, plugin management, and default service implementations.

The goal is to narrow the scope of building a new adapter to **just implementing the service interfaces** (and optionally plugins) defined in `finp2p-adapter-models`. A developer wiring up an Ethereum adapter only writes ERC-20 logic; a Canton adapter only writes CIP-56 logic. The skeleton handles the rest.

## Architecture

### Route layer (`src/routes/`)

- **`model-gen.ts`** &mdash; TypeScript types auto-generated from the DLT adapter API OpenAPI spec (`apis/dlt-adapter-api.yaml`). Generated via `npm run api-generate` using `openapi-typescript`, then post-processed by `scripts/postprocess-model-gen.ts` to handle circular references and export recursive types.
- **`routes.ts`** &mdash; Express route handlers for all DLT adapter API endpoints. The `register()` function is the main entry point and is **pure routing**: it takes finalized service implementations and mounts them on HTTP endpoints. All wiring (workflow proxy wrapping, plugin construction, account-mapping store/service, FinP2P client) must happen in the caller before `register()` is invoked. Signature: `register(app, tokenService, escrowService, commonService, healthService, paymentService, planService, networkAccountService, options?): void` where `options` is `{ mappingConfig?, mappingService?, whitelistService? }`. Endpoints:
  - **Plan**: `POST /api/plan/approve`, `POST /api/plan/proposal`, `POST /api/plan/proposal/status`
  - **Tokens**: `POST /api/assets/create`, `POST /api/assets/issue`, `POST /api/assets/transfer`, `POST /api/assets/swap`, `POST /api/assets/redeem`, `POST /api/assets/getBalance`, `POST /api/asset/balance`
  - **Escrow**: `POST /api/assets/hold`, `POST /api/assets/release`, `POST /api/assets/rollback`
  - **Payments**: `POST /api/payments/depositInstruction`, `POST /api/payments/payout`
  - **Accounts**: `POST /api/accounts/create` (202), `DELETE /api/accounts/:accountId` &mdash; `networkAccountService` defaults to `NotSupportedNetworkAccountService` (answers 501), so the account surface is opt-in and an existing adapter that passes nothing keeps compiling. `POST /api/accounts/:cid/proof` is a 501 stub: the sync trust model never issues challenges, so the router never has a proof to submit
  - **Common**: `GET /api/assets/receipts/:transactionId`, `GET /api/operations/status/:cid`
  - **Health**: `GET /health`, `GET /health/liveness`, `GET /health/readiness`
- **`operational.ts`** &mdash; **Adapter-internal** endpoints, outside the `/api` base path. The router never calls these; the adapter's own operators do. Typed from `apis/mapping-api.yaml`, which is skeleton-owned (not sourced from the router repo) &mdash; regenerate with `npm run mapping-api-generate`. Errors use a plain `{ error }` body with 400/500, not the DLT API envelopes.
  - **Account mapping**: `POST /mapping/owners`, `GET /mapping/owners`, `GET /mapping/fields`. Opt in with `options.mappingConfig` + `options.mappingService`.
  - **Investor whitelist**: `POST /investor/whitelist` (body `{ finId | address, assetId, config? }`), `DELETE /investor/whitelist?finId=|?address=&assetId=` (omit `assetId` to remove every entry for the party), `GET /investor/whitelist`. Opt in with `options.whitelistService`.
    - The skeleton stores nothing and enforces nothing here: it exposes the routes and the `InvestorWhitelistService` contract, and the adapter supplies the implementation (typically delegating to on-ledger enforcement).
    - A **party** is either a `finId` or a raw ledger `address` &mdash; exactly one. Address parties exist because some parties have no finId at all: an escrow custody wallet must be whitelisted or release fails, and cleaning up a replaced mapping leaves only an address. They are distinct keys, so the same string as a finId and as an address are two entries.
    - **`409` is a policy refusal, not a fault.** Throw `WhitelistRefusedError(message, mechanisms)` when the party stays blocked by mechanisms this deployment does not operate; the route reports the mechanism list so operators can finish onboarding elsewhere. Anything else becomes a 500, so a refusal is never confused with an RPC outage.
    - **Security.** Like the account-mapping endpoints, these are **unauthenticated** &mdash; the skeleton has no auth model, so it does not invent one here. They grant and revoke access, and a `DELETE` without `assetId` revokes a party for every asset in one call, so guard them at the ingress or with your own middleware (`app.use('/investor/whitelist', myAuth)`).

- **`mapping.ts`** &mdash; Bidirectional mapping functions between OpenAPI-generated types and domain model types from `finp2p-adapter-models`. Converts API request payloads into service method arguments and service results back into API responses.

  **Account variants.** Every variant of the OAS `networkAccount` union is representable in the domain model, on both paths:

  | Variant | Fields |
  |---------|--------|
  | `walletAccount` | `address` |
  | `caip10Account` | `network`, `address` |
  | `custodialAccount` | `provider`, `vaultAccountId`, `assetId?` |
  | `noneAccount` | &mdash; (empty object on the wire) |

  `LedgerAccount` is the inline union of the three bound variants (per-operation leg, `Source.account` / `Destination.account`); `NetworkAccount` is `LedgerAccount | { type: 'none' }` (onboarding), so the two cannot drift.

  **`custodialAccount` has no address** &mdash; switch on `type` rather than reaching for `.address`. A type outside the union still throws `AccountInvalidShapeError` (400) rather than degrading to `none`: degrading would report a successful bind while recording an empty account, the router whitelists `{}`, and every later operation naming the real account fails 7351 `AccountNotWhitelisted` with nothing at bind time to explain it.

  Rejecting a variant the ledger cannot service belongs in a `NetworkAccountValidator`, which is adapter policy &mdash; not in the mapper, which must represent everything the OAS defines.

  **EIP-712 type declarations.** `EIP712Template.types` is the name&rarr;fields map ethers wants, with `EIP712Domain` excluded. The router's full declaration (EIP712Domain included) hangs off the map under the `EIP712_DEFINITIONS` symbol, plus a non-enumerable `definitions` alias when no struct claims that name. Read it with `eip712Definitions(types)` &mdash; not `types.definitions`, which is the struct's fields if the message happens to define one.

  Both attachments are invisible to `Object.keys`/`JSON.stringify`/ethers, deliberately: the workflow dedupe key is `(method, inputs)` over serialized inputs, so making the declaration enumerable would change the key and let an operation stored by an older version execute twice after an upgrade. The cost is that `JSON.stringify` drops it, so a replayed operation would reach the adapter with the map alone &mdash; `createServiceProxy` rebuilds it via `rehydrateEip712Definitions(types, domain)` on the replay path.

  The rebuilt `EIP712Domain` entry lists exactly the members the template's `domain` carries, in canonical order (`name`, `version`, `chainId`, `verifyingContract`, `salt`). The router sends subsets, and inventing absent members would change the domain type hash and could reject a signature that was valid before. Without a domain the entry is omitted rather than guessed. A declaration entry the router sent with no `fields` is still not recoverable.

### Workflow layer (`src/workflows/`)

Provides **idempotent async operation persistence** backed by PostgreSQL:

- **`config.ts`** &mdash; Configuration interfaces: `MigrationConfig`, `StorageConfig`, `ProxyConfig` (callback support), `Config`
- **`storage.ts`** &mdash; PostgreSQL-based operation store. Tracks operations by correlation ID (`cid`), with status (`in_progress` / `succeeded` / `failed`), inputs (for idempotency), and outputs. Also provides asset storage for adapters that need it.
- **`service.ts`** &mdash; `createServiceProxy()` &mdash; the key abstraction. Wraps any service interface in a `Proxy` that:
  1. Generates a correlation ID for each new operation
  2. Stores the pending operation in PostgreSQL (deduplicates by input hash)
  3. Returns a `pending` response immediately to the router
  4. Executes the actual service method asynchronously
  5. Updates the operation status on completion
  6. Optionally sends a callback to the router via `FinP2PClient.sendCallback`
  7. On restart, replays all `in_progress` operations

  The replay rebuilds the stored arguments before calling the method. `JSON.stringify` writes `undefined` as `null` for an *array element*, and the stored inputs are the argument array &mdash; so an omitted optional argument comes back as `null` where the first call passed nothing, and every optional positional on the service interfaces is declared `| undefined`, not `| null`. `replayArgs` restores those top-level nulls to `undefined`; a `null` nested inside an argument was written as a real null and is left alone.
- **`migrator.ts`** &mdash; Runs database migrations using [goose](https://github.com/pressly/goose) (Go-based migration tool). Migrations are in `migrations/*.sql`.

### Durable sub-steps (`src/storage/steps.ts`)

`createServiceProxy` replays an unfinished operation from the top of the method, which is safe only while every effect is idempotent. `StepExecutor` records each sub-step's outcome, so a replay skips what already completed and resumes at the first step that didn't &mdash; an order submitted, a transaction broadcast. Values pass forward through the stored outcome: `place-order` returns the order reference and `await-settlement` reads it back on the next run.

```ts
const steps = new PgStepExecutors(pool, schemaName).forScope('wisdomtree');
const operation = { id: idempotencyKey, method: 'issue' };
const { orderReference } = await steps.step(operation, 'place-order', request,
  async (ctx) => placeOrder(request, ctx.token));
```

- **The host names the scope, never the plugin** &mdash; `forScope()` returns a bound executor, because a plugin that could name its own scope could read another's steps. Scope also disambiguates operation ids, which are not unique on their own (the same reason the `operations` unique index had to become `(method, inputs)`).
- **A step is identified by (scope, method, operation id, name).** The method is in the key because the operation id is normally the idempotency key, which carries no method &mdash; the same reason the `operations` unique index is `(method, inputs)`. `issue` and `redeem` can therefore arrive under one key, and without the method a step name used by both would be a single step, with the second method reading the first's outcome. Identical inputs hash alike, so `request` would not catch it.
- **Return vs throw is the contract.** A body that *returns* completes the step, including one returning a failure value &mdash; a 4xx refusal is a final outcome and must not be re-sent. A body that *throws* records nothing and leaves the step open, and the next attempt gets `ctx.priorAttempt`.
- **`ctx.token`** is stable per (method, operation id, name) across every attempt and restart, for use as a remote idempotency key &mdash; the only thing that closes the window between an effect and its outcome being recorded. It is the first 32 hex digits of the SHA-256, formatted as a UUID. The derivation is a **compatibility commitment, not merely a stable value**: the WisdomTree plugin sends it to Connect as `Idempotency-Key` and Connect keeps a key for hours, so a change would make the resend of an order already in flight look like a new order. Scope is deliberately not an input, because the host deriving it on a retry is not always the one that first sent it. Renaming a step changes it, which is the documented cost of a rename &mdash; and the intended way to handle a step whose request format changes: version the name rather than weaken the mismatch check.
- **Takeover, not a lease.** Another process's in-flight attempt is left alone for `takeoverAfterMs` (default 2 min) and then taken over, with `priorAttempt` set so a non-idempotent body can reconcile rather than repeat. `0` disables exclusion for read-only bodies such as polling. All comparisons use database time, never the process clock, so replicas with skewed clocks agree.
- **Completion is first-writer-wins on state**, not on attempt number: whoever records an outcome first keeps it, and a later finisher returns that outcome. Matching on attempt as well would fail both runners when they take the claim from each other, which `takeoverAfterMs: 0` invites. **Release matches on attempt**, for the opposite reason: a throw records nothing, so an attempt that was taken over must not clear the new owner's claim and hand the step to a third runner mid-flight.
- **Three states, and acquisition is a loop of separate statements.** `running` (an attempt is in flight), `open` (an attempt released it, so the next caller runs at once) and `done`. Acquisition is: insert the row if it has none; else read it under a snapshot of its own; else take it with a compare-and-set on `attempt`. The read cannot be folded into the insert &mdash; `ON CONFLICT` re-reads the index while a `SELECT` beside it answers from the statement's older snapshot, and the two disagree in both directions, both observed in CI: no row returned at all, and a finished row reported busy, discarding an outcome already stored. Losing the compare-and-set means another caller took the step, so the loop goes round rather than running alongside it; exhausting the turns raises a *retryable* `StepBusyError` rather than spinning.
- **The request hash is shared with the plugin host in generic-custody-adapter**, byte for byte, with the same vectors pinned in both test suites. Keys sort by code point (never by locale &mdash; collation depends on how Node was built, so two replicas could disagree); an object member that is `null` or `undefined` is dropped, because the proxy replays arguments stored as JSON where an omitted optional returns as `null`; an array element keeps its `null`, since dropping a hole would renumber the array.
- **Outcomes are JSON.** `undefined`, `Date`, `BigInt`, `Map` and non-enumerable properties do not survive the round trip &mdash; return plain JSON-safe values.

### Durable flows (`src/workflows/durable.ts`)

`StepExecutor` makes one effect survive a replay. A method with several effects had to hand-wire a `step()` call per effect, a try/catch around each, and a mapping from `STEP_BUSY`/`STEP_REQUEST_MISMATCH` to results. `durable` declares the blocks once and does that in one place.

```ts
const issue = durable<IssueInput, TokenOperationResult>('issue', (op) => {
  const order = op.block('resolve-order', { takeoverAfterMs: 0 },
    ({ input, refuse }) => resolveOrder(input) ?? refuse('no such asset'));
  const placed = op.block('place-order',
    ({ get, token, priorAttempt }) => priorAttempt
      ? findOrder(get(order))          // reconcile, do not place again
      : connect.createOrder(get(order), token));
  return op.block('await-settlement', { takeoverAfterMs: 0 },
    ({ get }) => awaitSettlement(get(placed)));
});

const outcome = await issue.run(steps, { id: operationId, request, input });
```

- **The declaration runs once**, when `durable()` is called &mdash; not per execution. `op.block` returns a `Handle` and a later block redeems it with `get`, because at declaration time there is no value to pass. So a flow is a fixed list of blocks in a fixed order, which is what makes a resume comprehensible. **A block cannot be declared conditionally**; a flow that needs to skip work has the block return a sentinel, so the decision is itself recorded. The two-leg swap in `tests/workflows/durable.test.ts` shows the shape: the revert cannot be a failure-path-only block, so the settlement block returns whether it settled and a final block acts on that.
- **A block name is its step name, permanently**, so it feeds `ctx.token`. Renaming a block changes the remote idempotency key, which for an order in flight means placing it twice. Nothing derives a name from a function name, a variable name or a position &mdash; deliberately, so that a refactor cannot change a token.
- **`run()` is the resume.** Calling it again walks the same blocks; completed ones return their rows without running, and the first unfinished one runs with `priorAttempt` set if an earlier attempt was taken over. There is no separate resume path.
- **Two ways to end early.** `stop(result)` is stored as the block's outcome, so every replay ends the same way &mdash; for a venue's refusal or a 409. `refuse(reason)` ends this call and stores nothing, so a retry runs the block again &mdash; for a condition an operator can fix, such as a missing asset. **`refuse` is only safe in a block that has had no effect yet**, since the retry repeats whatever the body already did.
- **`request` is passed to `run()` explicitly** and never defaults to `input`. An existing deployment hashes a particular shape (the WisdomTree plugin hashes a flat `side|token|wallet|amount` string); changing it would make every stored block report a mismatch.
- **A block stores its value bare; only a `stop` is wrapped.** An ordinary block's row is byte-for-byte what a direct `step()` call would have written, so a release using flows can be rolled back to one that does not, and `stored()` or an operator's query finds the fields where they have always been. A stop has to carry a marker because nothing in a value says it ended the flow — and a stop is terminal, so the whole of the incompatibility is "an older release cannot read a stopped row".
- **Adding a block in front of existing ones runs it on resume.** An operation that started before the block existed has no row for it, so a resume runs it first, after the later blocks have already had their effects. If the new block can refuse or has an effect, adopt it only once no operation predating it is in flight.
- **Import it from the subpath when you do not want the runtime.** `@owneraio/finp2p-nodejs-skeleton-adapter/durable` loads the runner and the step interfaces and nothing else — no Express, pg, winston, keccak or secp256k1, so no native builds. `tests/workflows/durable-imports.test.ts` guards that; the root entry point exports the same things for an adapter that has the whole skeleton loaded anyway. The default logger discards, deliberately, so **pass `run.logger`** — the one thing it records is which block a resume started at.

`ResourceClaims` is deliberately separate: it expresses uniqueness spanning operations (one ledger burn settling one redemption), carries no outcome and is never replayed. It is scope-bound the same way &mdash; `new PgResourceClaims(pool, schemaName).forScope('wisdomtree')`.

Both tables are created by `migrations/20261104090000_add_operation_steps.sql` with `CREATE TABLE IF NOT EXISTS`, because an adapter embedding its own plugin host creates the same two tables from its own migration and either may run first. **The columns must match that migration exactly**, in both repositories.

### Service defaults (`src/services/`)

Default implementations that adapter developers can extend or replace:

- **`plan/service.ts`** &mdash; `PlanApprovalServiceImpl` &mdash; default plan approval that auto-approves if no FinP2P client is configured. When a client is available, fetches the execution plan from the router and validates instructions via plugins. Proposal endpoints (cancel/reset/instruction) default to auto-approve.
- **`payments/payments.ts`** &mdash; `PaymentsServiceImpl` &mdash; delegates deposit/payout to plugins (sync or async variants). Returns failure if no plugin is registered.
- **`accounts/service.ts`** &mdash; `NetworkAccountServiceImpl` &mdash; investor account onboarding, **sync trust model**: the caller-supplied wallet is recorded as-is over a `NetworkAccountStore`, no ownership challenge (same trust the old finId&rarr;wallet mapping API extended). Optional `NetworkAccountValidator` hook for ledger address-shape checks. One binding per investor per (organizationId, assetId), keyed by the investor's `finId` carried on the request (required in the OAS): a repeat create for the same finId replays the recorded binding (even with a different wallet &mdash; changing wallets is remove + create). The same address may still be bound by many investors (omnibus &mdash; one shared wallet, many investors). Both methods are single-call and terminal &mdash; safe to wrap in `createServiceProxy`. The wallet also still arrives per operation on the instruction leg (`Source.account` / `Destination.account`). Challenge-based onboarding (signatureTemplate/walletConnect/deposit/fireblocksApproval, still present in the API spec) is deliberately not modeled &mdash; business requirements are unclear; add it when they firm up.
- **`proof/provider.ts`** &mdash; `ProofProvider` &mdash; generates cryptographic proofs (EIP-712 or hash-list) for receipts, fetching proof policies from the FinP2P node.
- **`verify.ts`** &mdash; Signature verification utilities.

### Plugin system (`src/plugins/`)

- **`manager.ts`** &mdash; `PluginManager` &mdash; registry for optional plugins: asset creation, plan approval, payments, and transaction hooks. Each plugin slot supports sync or async variants via `Plugin<S, A>`.

### Helpers (`src/helpers/`)

- Logger, EIP-712 hashing, hash list computation utilities. Re-exported from `src/index.ts`.

## How to build a new adapter

1. Create a new project (or copy `sample-adapter`)
2. Depend on `@owneraio/finp2p-nodejs-skeleton-adapter` and `@owneraio/finp2p-adapter-models`
3. Implement the service interfaces that match your ledger's capabilities:
   - `TokenService` for token issue/transfer/redeem (most adapters need this)
   - `EscrowService` for hold/release/rollback
   - Optionally register plugins for payments, plan approval, transaction hooks
4. Construct your services. If you want PostgreSQL-backed async workflows, create a `pg.Pool`, build a `WorkflowStorage(pool)`, and wrap each service with `createServiceProxy(...)` before passing them to `register()`. The caller owns the pool lifecycle.
5. For investor account onboarding, construct `NetworkAccountServiceImpl(store, validator?)` backed by a `NetworkAccountStore` (e.g. `PgNetworkAccountStore(pool)`); if the ledger has no account support, use `NotSupportedNetworkAccountService`.
6. If you want account mapping (deprecated, superseded by network accounts), construct an `AccountStore` (e.g. `PgAccountStore(pool)`) and an `AccountMappingServiceImpl(store)`, and pass them via `options`.
7. For investor whitelisting, implement `InvestorWhitelistService` yourself and pass it as `options.whitelistService`. The skeleton provides the HTTP surface and the contract only &mdash; it defines no whitelisting semantics and no storage, because whether membership lives on-ledger or off is the adapter's call. Omit the service and the endpoints aren't mounted.
8. Call `routes.register(app, tokenService, escrowService, commonService, healthService, paymentService, planService, networkAccountService, { mappingConfig?, mappingService?, whitelistService? })`.

## API spec management

The OpenAPI spec `apis/dlt-adapter-api.yaml` is sourced from the FinP2P router (node) repo. To regenerate types:

```bash
npm run api-generate   # generates model-gen.ts from the YAML spec
```

A post-processor (`scripts/postprocess-model-gen.ts`) handles:
- Circular type references that `openapi-typescript` can't resolve
- Exporting recursive types for `.d.ts` declaration files
- Quoting member names that contain hyphens

## Database

When workflow persistence is enabled, the skeleton uses PostgreSQL with a consumer-chosen schema: `MigrationConfig.schemaName` is required and reaches the SQL files via the `LEDGER_SCHEMA` env var (`${LEDGER_SCHEMA?...}` — goose fails the migration if unset). Migrations:
- `20251020114833_initial_tables.sql` &mdash; `operations` table (cid, method, status, inputs, outputs)
- `20260105064721_add_assets_table.sql` &mdash; `assets` table (id, type, contract_address, decimals)
- `20260727060730_create_network_accounts_table.sql` &mdash; `network_accounts` table: one binding per investor per (org, asset) &mdash; account_id PK, unique (organization_id, asset_id, fin_id), idempotency_key as trace field, account jsonb

Migrations run automatically on startup via goose.

## Build & publish

```bash
npm run build          # tsc
npm run api-generate   # regenerate model-gen.ts from OpenAPI spec
npm test               # jest (requires PostgreSQL via testcontainers + goose)
```

Publish is triggered by git tag `skeleton-v*`.

## Versioning

Major.minor correlates with the FinP2P router version (e.g. skeleton 0.27.x works with router 0.27.x).

## See also

- [Top-level CLAUDE.md](../CLAUDE.md) &mdash; monorepo overview and dependency graph
- [finp2p-adapter-models/CLAUDE.md](../finp2p-adapter-models/CLAUDE.md) &mdash; service interfaces and domain types this skeleton consumes
- [sample-adapter/CLAUDE.md](../sample-adapter/CLAUDE.md) &mdash; reference implementation using this skeleton
- [adapter-tests/CLAUDE.md](../adapter-tests/CLAUDE.md) &mdash; integration test suite for adapters built with this skeleton

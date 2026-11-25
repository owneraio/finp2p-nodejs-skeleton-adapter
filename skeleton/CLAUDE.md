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
  - **Tokens**: `POST /api/assets/create`, `POST /api/assets/issue`, `POST /api/assets/transfer`, `POST /api/assets/swap`, `POST /api/assets/move`, `POST /api/assets/redeem`, `POST /api/assets/getBalance`, `POST /api/asset/balance` &mdash; `move` is the only token route backed by an **optional** service method (`TokenService.move?`), so an adapter with no conversion path keeps compiling and the route answers a failed receipt saying move is not supported. See **Move** below.
  - **Escrow**: `POST /api/assets/hold`, `POST /api/assets/release`, `POST /api/assets/rollback`
  - **Payments**: `POST /api/payments/depositInstruction`, `POST /api/payments/payout`
  - **Accounts**: `POST /api/accounts/create` (202, or 207 when the answer carries a challenge), `POST /api/accounts/:cid/proof`, `DELETE /api/accounts/:accountId`. `networkAccountService` defaults to `NotSupportedNetworkAccountService` (answers 501), so the account surface is opt-in and an existing adapter that passes nothing keeps compiling. The proof route calls `networkAccountService.submitAccountProof`, which the workflow proxy provides for a service that implements `completeAccountChallenge` (see **Account challenges**); a service without it answers 501.
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

### Move (`POST /api/assets/move`)

A move converts a holding from one asset binding into another. It is not a trade, so there is no counterparty leg and no settlement leg. DTCC Classic to Besu is the case it was added for. The request carries a full `source` and `destination` account, each with its own finId, and the skeleton reads neither as a claim about who owns the holding: one investor can hold several keys, and `moveDestination.fromSegregatedAccountOwner` names a different debited party outright for the pre-funded-pool variants.

```
move?(idempotencyKey, nonce, source, destination, asset, destinationAsset, quantity, signature, operationId, exCtx)
```

- **The method is optional on `TokenService`.** This is deliberate: making it required would break every adapter built against an earlier 0.29.x on a patch bump. The route checks for it per request and, when it is absent, answers `200` with the API's failure envelope rather than letting Express 404. A 404 reads to the router as "no such route on this adapter", which is a different fault from "this adapter cannot convert", and the two lead it to different recoveries.
- **`asset` and `destinationAsset` are both passed.** Unlike `transfer`, where one binding serves both ends, a move normally crosses assets, so the destination binding is read from `destination.asset` rather than reconstructed from the source.
- **The destination binding also rides in `exCtx.counterpartyAssetId`.** That field is what `receiptToAPI` reads to bind the destination side of the receipt. The name says counterparty because `transfer` and `swap` got there first; the mechanism is "the binding on the other end of this leg", which for a move is the asset the holding converts into.
- **Receipts carry `operationType: 'move'`,** which is in the domain `OperationType` union as well as the wire one.
- **Set `receipt.destinationAsset` on a move receipt.** It is optional on the domain `Receipt` and, when present, `receiptToAPI` uses it verbatim for `destination.asset`, `ledgerIdentifier` included, in preference to anything the execution context says. Without it the destination binding is inferred as `{ ...sourceAsset, resourceId: counterpartyAssetId }`, which is correct for transfer and swap, where both sides bind the **same** on-chain token, and wrong for a move, where they are different tokens. The router rejects the receipt callback with `4001 Missing required field "operation.response.destination.asset.ledgerIdentifier"` when the destination asset cannot be built, and a direct move (no plan, so no execution context) has no `counterpartyAssetId` to infer from at all.
  - A `1002 input does not contain the discriminator property type` usually arrives alongside that 4001 and is **not** a second missing field. The callback body is `oneOf [dlt-adapter-api operationStatus, custody-adapter-api operationStatus]`. The DLT branch matches on `type: 'receipt'` and reports the real error; the custody branch discriminates on `operation.type`, which a receipt envelope does not have, so it always adds that 1002. Fix the first error and the second goes with it. In particular the receipt asset does **not** need a `type: 'finp2p'` field: the wire `asset` is `finp2pAssetBase`, which has no `type` (`finp2pAssetWithType` is a different schema, used elsewhere).
- **A move the adapter cannot settle on both ends is the adapter's to refuse,** and only the adapter can: the skeleton does not know which assets an adapter holds bindings for. Do not reach for a proxy. Comparing the assets' organizations, as the Go adapters' vanilla `handler.go` does, refuses valid moves on an adapter serving several organizations, and the spec permits colons inside an organization id so the comparison is not even a split on the first one. Comparing `source.finId` with `destination.finId` is wrong for a different reason: one investor can hold several keys, and `moveDestination.fromSegregatedAccountOwner` names a different debited party for the pre-funded-pool variants. The Go adapters also validate the Move EIP-712 template before executing; the skeleton does not, because it verifies no signatures on any route. The full `signature.template` reaches the service, so the adapter can verify from what the router sent without the skeleton knowing a Move primary type.
- **Proxying it needs no special case:** pass `'move'` to `createServiceProxy` like any other method and it gets the pending/failed receipt envelope.

### Workflow layer (`src/workflows/`)

Provides **idempotent async operation persistence** backed by PostgreSQL:

- **`config.ts`** &mdash; Configuration interfaces: `MigrationConfig`, `StorageConfig`, `ProxyConfig` (callback support), `Config`
- **`storage.ts`** &mdash; PostgreSQL-based operation store. Tracks operations by correlation ID (`cid`), with status (`in_progress` / `awaiting_proof` / `succeeded` / `failed`; `awaiting_proof` is a create parked on an account challenge), inputs (for idempotency), and outputs. Also provides asset storage for adapters that need it.
- **`service.ts`** &mdash; `createServiceProxy()` &mdash; the key abstraction. Wraps any service interface in a `Proxy` that:
  1. Generates a correlation ID for each new operation
  2. Stores the pending operation in PostgreSQL (deduplicates by input hash)
  3. Returns a `pending` response immediately to the router
  4. Executes the actual service method asynchronously
  5. Updates the operation status on completion
  6. Optionally sends a callback to the router via `FinP2PClient.sendCallback`
  7. On restart, replays all `in_progress` operations (a create whose challenge a proof had claimed is reopened instead)
  8. For a service that implements `completeAccountChallenge`, runs `createAccount` inside its request and answers `submitAccountProof` from the operations rows (see **Account challenges**)
- **`migrator.ts`** &mdash; Runs database migrations using [goose](https://github.com/pressly/goose) (Go-based migration tool). Migrations are in `migrations/*.sql`.

### Service defaults (`src/services/`)

Default implementations that adapter developers can extend or replace:

- **`plan/service.ts`** &mdash; `PlanApprovalServiceImpl` &mdash; default plan approval that auto-approves if no FinP2P client is configured. When a client is available, fetches the execution plan from the router and validates instructions via plugins. Proposal endpoints (cancel/reset/instruction) default to auto-approve.
- **`payments/payments.ts`** &mdash; `PaymentsServiceImpl` &mdash; delegates deposit/payout to plugins (sync or async variants). Returns failure if no plugin is registered.
- **`accounts/service.ts`** &mdash; `NetworkAccountServiceImpl` &mdash; investor account onboarding, **sync trust model**: the caller-supplied wallet is recorded as-is over a `NetworkAccountStore`, no ownership challenge (same trust the old finId&rarr;wallet mapping API extended). Optional `NetworkAccountValidator` hook for ledger address-shape checks. One binding per investor per (organizationId, assetId), keyed by the investor's `finId` carried on the request (required in the OAS): a repeat create for the same finId replays the recorded binding (even with a different wallet: changing wallets is remove + create). The same address may still be bound by many investors (omnibus: one shared wallet, many investors). Both methods are single-call and terminal, so safe to wrap in `createServiceProxy`. The wallet also still arrives per operation on the instruction leg (`Source.account` / `Destination.account`). It never issues a challenge itself. To challenge first, extend it: answer `createAccount` with `challengedAccountOperation`, implement `completeAccountChallenge`, and record with the protected `recordAccount` (see **Account challenges**).
- **`proof/provider.ts`** &mdash; `ProofProvider` &mdash; generates cryptographic proofs (EIP-712 or hash-list) for receipts, fetching proof policies from the FinP2P node.
- **`verify.ts`** &mdash; Signature verification utilities.

### Account challenges

A create/bind may answer with a challenge the investor must fulfill before the account is bound. The domain model carries the four OAS variants (`walletConnect`, `signatureTemplate`, `deposit`, `fireblocksApproval`), the ones the router maps; the skeleton verifies none of them, the adapter does in `completeAccountChallenge`.

- **Issue**: `createAccount` returns `challengedAccountOperation('', challenge, expiresInSeconds?)`. Under `createServiceProxy(..., 'createAccount', ...)` with a service that implements `completeAccountChallenge`, the proxy runs `createAccount` inside the create request (a polling router never surfaces a challenge that arrives later), stamps its cid and response strategy on the challenge, parks the row in `awaiting_proof` and answers 207. There `createAccount` must settle or challenge: a pending result fails the create, since nothing could finish it later. A create retried with the same Idempotency-Key waits for the running create, or gets the stored answer; one whose result failed to persist runs again.
- **Proof**: the router posts `POST /accounts/{cid}/proof` with a fresh Idempotency-Key every time. The proxy claims the row (`awaiting_proof` -> `in_progress`, compare-and-set), calls `completeAccountChallenge(ik, issued, proof)` and settles the row. Return success or failure to settle; throw to reopen the challenge (`AccountProofRefusedError` -> 401 with its code, 7345 by default; any other error, whatever its class, -> 500). A validator refusal from `recordAccount` is such an error: catch it and return a failure to end the onboarding.
- **Outcome**: reaches the router on the create cid, by callback (callback strategy) or `GET /operations/status/{cid}` (polling); the proof's 200 body is informational. The callback is sent once, like every proxied operation's; a repeated proof on a settled create only answers the stored outcome.
- **Expiry**: passive. The challenge stores `expiresAt` (epoch seconds) and the wire carries the whole seconds left, never 0, from which the router arms its own timeout. The skeleton acts on it nowhere: no timer, no check when a proof arrives. `completeAccountChallenge` gets `issued.expiresAt`; to end an expired challenge it returns a failure with `AccountErrorCodes.challengeTimeout` (7346), and later proofs for that create answer 410. A challenge nobody confirms stays `awaiting_proof`: in callback mode that is one idle row, in poll mode the router's poller keeps re-polling its status (its queue has no delivery cap). An `expiresInSeconds` that is absent, 0, negative or not finite means no expiry.
- **Restart**: an `in_progress` create replays before the proxy serves requests; one claimed by a proof is reopened (the proof request failed, so the investor sends it again). Assumes one adapter instance per schema, like every replay.
- Without the proxy, the proof route answers 501 unless the service implements `submitAccountProof` itself, and a challenge without a cid fails the create with 501.

| row (`operations`) | proof answer |
|---|---|
| `awaiting_proof` (expired or not) | claims it and runs `completeAccountChallenge`: 200 with the outcome |
| `in_progress`, challenge claimed | 200 pending |
| `in_progress`, no challenge yet | 409 (7349) |
| `succeeded` | 200 with the stored outcome |
| `failed` | 410 (7346) or 409 (7349) |
| unknown cid, or not a create | 404 (7348) |

`signatureTemplate` is an ownership proof for binding an existing wallet. Platform convention (vanilla Go adapter, router e2e): `payload` = 32 random bytes, signed raw with secp256k1 (64-byte `r||s`), verified against the wallet address = its public key (`verifySecp`). The router and proxy verify nothing (empty signatures pass the router's hex check), so `completeAccountChallenge` must, refusing empty or foreign signatures with `AccountProofRefusedError` (7345). Never treat a proof as a bare "done": extra preconditions, e.g. an administrator allowlist, go on top of a verified signature (sample-adapter `allowlist.ts`). The OAS documents the proof for `signatureTemplate` and lists only its 200; the 4xx answers above are the skeleton's, and the router passes their codes to the client. A type the router does not map (finp2p-core `ChallengeToProto`) fails the onboarding with 7350.

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
5. For investor account onboarding, construct `NetworkAccountServiceImpl(store, validator?)` backed by a `NetworkAccountStore` (e.g. `PgNetworkAccountStore(pool)`); if the ledger has no account support, use `NotSupportedNetworkAccountService`. To issue challenges, extend `NetworkAccountServiceImpl` as described in **Account challenges** and wrap it in `createServiceProxy(ready, storage, finP2PClient, service, 'createAccount', 'removeAccount')`; challenges need the PostgreSQL workflow store.
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
- `20261123120000_widen_account_mapping_value.sql` &mdash; `account_mappings.value` becomes `TEXT` (an encrypted per-wallet token does not fit 255), and its index becomes a hash index on `value`, because btree refuses an entry over about 2.7 KB and lookups by value are equality only
- `20261125120000_add_awaiting_proof_status.sql`: adds `awaiting_proof` to `operation_status` (a create parked on an account challenge). Runs with `-- +goose NO TRANSACTION`, since `ALTER TYPE ... ADD VALUE` cannot run in a transaction block before Postgres 12.

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

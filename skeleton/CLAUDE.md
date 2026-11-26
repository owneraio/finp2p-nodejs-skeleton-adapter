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
  - **Tokens**: `POST /api/assets/create`, `POST /api/assets/issue`, `POST /api/assets/transfer`, `POST /api/assets/swap`, `POST /api/assets/move`, `POST /api/assets/redeem`, `POST /api/assets/getBalance`, `POST /api/asset/balance`, `POST /api/assets/getCapabilities`. Two token routes are backed by **optional** service methods, so an adapter without them keeps compiling: without `TokenService.move?` the move route answers a failed receipt saying move is not supported (see **Move** below), and without `TokenService.getCapabilities` the getCapabilities route answers 501; an unknown asset is reported with `AssetNotFoundError`, 404; a body without a usable `asset`, or an `executionContext.contract` that is not a string, answers 400
  - **Execution context**: `executionContext.contract` (when the router picks one of the contracts an asset lists) reaches the service as `ExecutionContext.contract`; it is never echoed back on receipts
  - **Contract identity**: a listed contract is `{ address, addressFormat, restrictions? }` with `addressFormat` one of `caip10`, `url`, `opaque`; there is no name, display names come from a data provider. The router stores the address as sent and compares two addresses after normalizing by format. Every format: at most 1024 bytes, valid UTF-8, no control or format characters. caip10: namespace lowercased, an eip155 account of 0x plus 40 hex digits lowercased, a decimal eip155 chain reference without leading zeros, every other part keeps its case. url: scheme and the ASCII letters of the host lowercased, port stripped of leading zeros (above 65535 rejected) and dropped for http 80 and https 443, an http or https URL needs a host, a bracketed host must be an IPv6 literal, dot segments kept (not resolved), percent-encoding normalized, empty path with an authority becomes `/`, fragments, user info, an unbracketed host with more than one colon and invalid percent escapes in the query or opaque part rejected, the query kept as sent, the opaque part of a URL such as `mailto:` percent-encoding-normalized like a path. opaque: exact. Formats must match, and an address that does not normalize equals nothing, so an adapter should compare `ExecutionContext.contract` with its listed addresses the same way
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

### Configuration API (`src/config/`, exported as `config`)

`config.registerConfigRoutes(app, service, { logger?, jsonLimit?, controlCenter? })` mounts the adapter's configuration API under `/config`; the adapter implements `ConfigurationService` (`service.ts`) and the skeleton knows none of its fields. Register it before any app-wide body parser (a parsed body is answered 500), and serve it on a port only the operator's backend reaches: the routes are unauthenticated, write secrets and restart the adapter.

- **Field API** (`routes.ts`): `GET /status`, `GET /schema`, `GET`/`PUT /values`, `POST /validate`, `POST /apply`, `POST /actions/:ref`. E2E scripts and Control Center depend on their statuses and messages. Every message is scrubbed of `sealedValues()`; a service throw answers 500 without its message.
- **Control Center** (`control-center/`, with `opts.controlCenter = { wizardId, adapter, timeoutMs? }`): `GET /manifest` and `POST /operations/:id`. The manifest is derived from the service (`derive.ts`), never written by an adapter: one integration flow `configure` with `get-values` (when the service has `inputValues`), `save-<stepId>` per step and `activate`, plus `get-status`. No idempotency: every operation declares `none` and a key sent is ignored.
- **Control Center's bounds.** It refuses a whole manifest over any excess, so registration throws on what it would refuse (ids, identity, networks, timeout up to 30 s, step and input counts, schema depth). A `format.pattern` it would refuse (`pattern-safety.ts`, a verbatim copy of ownera-apps `AdapterConfig/patternSafety.ts`) is left out and logged instead, for `saveStep` to check. Text is clipped in UTF-16 units, as Control Center counts.
- **Wire ids.** Control Center sees an input id with each `.` as `_` (its refusal pointers allow no dot); the skeleton maps both ways, so `saveStep` only sees the adapter's ids.
- **Secrets.** A secret input is never schema-required (empty keeps the stored value), and `get-values` answers it only as `set` or `not_set`, never any part of it.
- **Status.** `get-status` answers Control Center's envelope (`tests/config/support/status-fault.ts` copies its check): `{ integration: { state, details }, networks: [{ id, state }] }`, details fitted to 8 rows rather than failing.

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
- **`migrator.ts`** &mdash; Runs database migrations using [goose](https://github.com/pressly/goose) (Go-based migration tool). Migrations are in `migrations/*.sql`.

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
- `20261123120000_widen_account_mapping_value.sql` &mdash; `account_mappings.value` becomes `TEXT` (an encrypted per-wallet token does not fit 255), and its index becomes a hash index on `value`, because btree refuses an entry over about 2.7 KB and lookups by value are equality only

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

# skeleton

> `@owneraio/finp2p-nodejs-skeleton-adapter` &mdash; Published to **GitHub Packages**

## Purpose

The skeleton is the **main framework** for building FinP2P ledger adapters in Node.js. It provides everything except the ledger-specific logic: HTTP route handlers, request/response mapping, async workflow persistence, plugin management, and default service implementations.

The goal is to narrow the scope of building a new adapter to **just implementing the service interfaces** (and optionally plugins) defined in `finp2p-adapter-models`. A developer wiring up an Ethereum adapter only writes ERC-20 logic; a Canton adapter only writes CIP-56 logic. The skeleton handles the rest.

## Architecture

### Route layer (`src/routes/`)

- **`model-gen.ts`** &mdash; TypeScript types auto-generated from the DLT adapter API OpenAPI spec (`apis/dlt-adapter-api.yaml`). Generated via `npm run api-generate` using `openapi-typescript`, then post-processed by `scripts/postprocess-model-gen.ts` to handle circular references and export recursive types.
- **`routes.ts`** &mdash; Express route handlers for all DLT adapter API endpoints. The `register()` function is the main entry point and is **pure routing**: it takes finalized service implementations and mounts them on HTTP endpoints. All wiring (workflow proxy wrapping, plugin construction, account-mapping store/service, FinP2P client) must happen in the caller before `register()` is invoked. Signature: `register(app, tokenService, escrowService, commonService, healthService, paymentService, planService, networkAccountService, options?): void` where `options` is `{ mappingConfig?, mappingService?, whitelistService?, whitelistOptions? }`. Endpoints:
  - **Plan**: `POST /api/plan/approve`, `POST /api/plan/proposal`, `POST /api/plan/proposal/status`
  - **Tokens**: `POST /api/assets/create`, `POST /api/assets/issue`, `POST /api/assets/transfer`, `POST /api/assets/redeem`, `POST /api/assets/getBalance`, `POST /api/asset/balance`
  - **Escrow**: `POST /api/assets/hold`, `POST /api/assets/release`, `POST /api/assets/rollback`
  - **Payments**: `POST /api/payments/depositInstruction`, `POST /api/payments/payout`
  - **Accounts**: `POST /api/accounts/create` (202), `DELETE /api/accounts/:accountId` &mdash; `networkAccountService` defaults to `NotSupportedNetworkAccountService` (answers 501), so the account surface is opt-in and an existing adapter that passes nothing keeps compiling. `POST /api/accounts/:cid/proof` is a 501 stub: the sync trust model never issues challenges, so the router never has a proof to submit
  - **Common**: `GET /api/assets/receipts/:transactionId`, `GET /api/operations/status/:cid`
  - **Health**: `GET /health`, `GET /health/liveness`, `GET /health/readiness`
- **`operational.ts`** &mdash; **Adapter-internal** endpoints, outside the `/api` base path. The router never calls these; the adapter's own operators do. Typed from `apis/mapping-api.yaml`, which is skeleton-owned (not sourced from the router repo) &mdash; regenerate with `npm run mapping-api-generate`. Errors use a plain `{ error }` body with 400/500, not the DLT API envelopes.
  - **Account mapping**: `POST /mapping/owners`, `GET /mapping/owners`, `GET /mapping/fields`. Opt in with `options.mappingConfig` + `options.mappingService`.
  - **Investor whitelist**: `POST /investor/whitelist` (body `{ finId | address, assetId, config? }`), `DELETE /investor/whitelist?finId=|?address=&assetId=` (omit `assetId` to remove every entry for the party), `GET /investor/whitelist`. Opt in with `options.whitelistService`; guard with `options.whitelistOptions.authToken`.
    - The skeleton stores nothing and enforces nothing here: it exposes the routes and the `InvestorWhitelistService` contract, and the adapter supplies the implementation (typically delegating to on-ledger enforcement).
    - A **party** is either a `finId` or a raw ledger `address` &mdash; exactly one. Address parties exist because some parties have no finId at all: an escrow custody wallet must be whitelisted or release fails, and cleaning up a replaced mapping leaves only an address. They are distinct keys, so the same string as a finId and as an address are two entries.
    - **`409` is a policy refusal, not a fault.** Throw `WhitelistRefusedError(message, mechanisms)` when the party stays blocked by mechanisms this deployment does not operate; the route reports the mechanism list so operators can finish onboarding elsewhere. Anything else becomes a 500, so a refusal is never confused with an RPC outage.
    - **Security.** These endpoints grant and revoke access, and a `DELETE` without `assetId` revokes a party for every asset in one call. Set `authToken` (checked as `Authorization: Bearer <token>` on all three routes) or keep them behind a trusted network boundary.

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
7. For investor whitelisting, implement `InvestorWhitelistService` yourself and pass it as `options.whitelistService`. The skeleton provides the HTTP surface and the contract only &mdash; it defines no whitelisting semantics and no storage, because whether membership lives on-ledger or off is the adapter's call. Omit the service and the endpoints aren't mounted. Pass `options.whitelistOptions.authToken` to guard them.
8. Call `routes.register(app, tokenService, escrowService, commonService, healthService, paymentService, planService, networkAccountService, { mappingConfig?, mappingService?, whitelistService?, whitelistOptions? })`.

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

When workflow persistence is enabled, the skeleton uses PostgreSQL with a `ledger_adapter` schema. Migrations:
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

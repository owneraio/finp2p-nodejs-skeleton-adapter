# skeleton

> `@owneraio/finp2p-nodejs-skeleton-adapter` &mdash; Published to **GitHub Packages**

## Purpose

The skeleton is the **main framework** for building FinP2P ledger adapters in Node.js. It provides everything except the ledger-specific logic: HTTP route handlers, request/response mapping, async workflow persistence, plugin management, and default service implementations.

The goal is to narrow the scope of building a new adapter to **just implementing the service interfaces** (and optionally plugins) defined in `finp2p-adapter-models`. A developer wiring up an Ethereum adapter only writes ERC-20 logic; a Canton adapter only writes CIP-56 logic. The skeleton handles the rest.

## Architecture

### Route layer (`src/routes/`)

- **`model-gen.ts`** &mdash; TypeScript types auto-generated from the DLT adapter API OpenAPI spec (`apis/dlt-adapter-api.yaml`). Generated via `npm run api-generate` using `openapi-typescript`, then post-processed by `scripts/postprocess-model-gen.ts` to handle circular references and export recursive types.
- **`routes.ts`** &mdash; Express route handlers for all DLT adapter API endpoints. The `register()` function is the main entry point: it takes service implementations and wires them to HTTP endpoints. Endpoints:
  - **Plan**: `POST /api/plan/approve`, `POST /api/plan/proposal`, `POST /api/plan/proposal/status`
  - **Tokens**: `POST /api/assets/create`, `POST /api/assets/issue`, `POST /api/assets/transfer`, `POST /api/assets/redeem`, `POST /api/assets/getBalance`, `POST /api/asset/balance`
  - **Escrow**: `POST /api/assets/hold`, `POST /api/assets/release`, `POST /api/assets/rollback`
  - **Payments**: `POST /api/payments/depositInstruction`, `POST /api/payments/payout`
  - **Common**: `GET /api/assets/receipts/:transactionId`, `GET /api/operations/status/:cid`
  - **Health**: `GET /health`, `GET /health/liveness`, `GET /health/readiness`
- **`mapping.ts`** &mdash; Bidirectional mapping functions between OpenAPI-generated types and domain model types from `finp2p-adapter-models`. Converts API request payloads into service method arguments and service results back into API responses.

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
4. Call `routes.register(app, tokenService, escrowService, ...)` with your implementations
5. Pass a `Config` if you want PostgreSQL-backed async workflows (recommended for production)

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

# sample-adapter

> `@owneraio/sample-adapter` &mdash; Published to **GitHub Packages**

## Purpose

**Reference implementation** of a FinP2P ledger adapter using the skeleton framework. Demonstrates how to build an adapter by implementing the service interfaces with in-memory storage. Serves as both a template for new adapters and a testbed for the skeleton + adapter-tests packages.

This is **not** a production adapter. It emulates ledger functionality in memory. For real deployments, replace the in-memory services with actual ledger integrations (e.g., Ethereum ERC-20, Canton CIP-56, Hyperledger Fabric).

## Architecture

### Entry point (`src/index.ts`)

Reads configuration from environment variables, optionally creates a `FinP2PClient`, and starts the Express server.

**Environment variables:**
- `PORT` &mdash; Server port (default: 3000)
- `ORGANIZATION_ID` &mdash; Required. The adapter's organization ID in the FinP2P network.
- `FINP2P_ADDRESS` &mdash; Optional. FinP2P router API URL (enables plan approval via router).
- `OSS_URL` &mdash; Optional. OSS GraphQL URL (enables proof generation).
- `SIGNER_PRIVATE_KEY` &mdash; Optional. Private key for receipt proofs.

### App setup (`src/app.ts`)

Creates the Express app and wires everything together:

```typescript
const tokenService = new TokenServiceImpl(storage, proofProvider);
const escrowService = new EscrowServiceImpl(storage, proofProvider);
const paymentsService = new PaymentsServiceImpl(pluginManager);
const planApprovalService = new PlanApprovalServiceImpl(orgId, pluginManager, finP2PClient);

routes.register(app, tokenService, escrowService, tokenService, tokenService, paymentsService, planApprovalService, pluginManager, migrationsConfig);
```

Note: `tokenService` implements both `TokenService`, `CommonService`, and `HealthService` in this sample (via `CommonServiceImpl` base class).

### In-memory services (`src/services/inmemory/`)

- **`storage.ts`** &mdash; `Storage` &mdash; in-memory maps for assets, accounts, and hold operations. Tracks balances per (finId, assetId) pair.
- **`accounts.ts`** &mdash; `Account` &mdash; balance tracking with credit/debit operations.
- **`tokens.ts`** &mdash; `TokenServiceImpl` implements `TokenService`: create asset, issue (mint), transfer, redeem (burn), balance queries. Generates receipts with optional ledger proofs.
- **`escrow.ts`** &mdash; `EscrowServiceImpl` implements `EscrowService`: hold (escrow funds), release (to destination), rollback (return to source).
- **`common.ts`** &mdash; `CommonServiceImpl` &mdash; base class providing receipt storage, health checks, and `getReceipt`/`operationStatus` from in-memory transaction log.
- **`model.ts`** &mdash; `Transaction`, `HoldOperation` &mdash; internal models for building receipts.

### Plugins (`src/plugins/`)

- **`delayed-approvals.ts`** &mdash; `DelayedApprovals` implements `AsyncPlanApprovalPlugin`. Demonstrates async plan approval: validates via the FinP2P router and sends callback when done. Only active when `FinP2PClient` is configured.

## Tests

Tests use the shared `@owneraio/adapter-tests` suite:

```typescript
// tests/adapter.test.ts
import { runAdapterTests } from "@owneraio/adapter-tests";
runAdapterTests();
```

The test environment (`tests/test-environment.ts`) starts a PostgreSQL container via testcontainers, runs goose migrations, and starts the sample adapter app.

## Build & run

```bash
npm run build        # tsc
npm test             # jest (requires Docker for testcontainers + goose)
npm run start        # node . (production)
npm run start-debug  # ts-node (development)
```

## See also

- [Top-level CLAUDE.md](../CLAUDE.md) &mdash; monorepo overview
- [skeleton/CLAUDE.md](../skeleton/CLAUDE.md) &mdash; the framework this adapter is built on
- [finp2p-adapter-models/CLAUDE.md](../finp2p-adapter-models/CLAUDE.md) &mdash; interfaces implemented here
- [adapter-tests/CLAUDE.md](../adapter-tests/CLAUDE.md) &mdash; test suite used here

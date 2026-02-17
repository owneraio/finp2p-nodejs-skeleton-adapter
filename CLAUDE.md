# FinP2P Node.js Skeleton Adapter &mdash; Monorepo

## What is this

A monorepo for building **FinP2P ledger adapters** in Node.js. The FinP2P protocol enables cross-organization orchestration of financial operations (DvP, Repo, collateral mobility, etc.) through a **router** (node) that decomposes high-level business operations into simple executable instructions. An **adapter** translates those instructions into ledger-specific operations (e.g., Ethereum ERC-20 movements, Canton CIP-56 movements, Hyperledger Fabric chaincode calls).

This skeleton provides the boilerplate so adapter developers only need to implement **service interfaces** corresponding to their ledger's capabilities.

## How the FinP2P adapter fits in

```
  FinP2P Router (Node)
       |
       | DLT Adapter API (OpenAPI)
       v
  ┌─────────────────────────────────┐
  │  skeleton (Express routes,      │
  │  mapping, workflow persistence) │
  │         |                       │
  │    Service interfaces           │
  │    (from adapter-models)        │
  │         |                       │
  │  YOUR IMPLEMENTATION            │
  │  (e.g. Ethereum, Canton, etc.)  │
  └─────────────────────────────────┘
```

The router is responsible for cross-organization orchestration. It defines the API spec (`dlt-adapter-api.yaml`). The adapter implements that API, translating FinP2P instructions into ledger-specific calls.

## Service capabilities

Each adapter implements a subset of these service interfaces (defined in `finp2p-adapter-models`):

| Service | Ledger capability | Operations |
|---------|------------------|------------|
| **TokenService** | Token lifecycle | createAsset, issue (mint), transfer, redeem (burn), balance |
| **EscrowService** | Escrow / holds | hold, release, rollback |
| **PaymentService** | Fiat/crypto payments | deposit instruction, payout |
| **PlanApprovalService** | Execution plan control | approve plan, propose cancel/reset/instruction, proposal status |
| **CommonService** | Cross-cutting | get receipt, operation status |

Plan approval is not mandatory but gives the adapter context about the orchestration plan, an extra preparation step, and a way to stop the orchestration before execution begins.

## Subprojects

| Package | npm name | Purpose | CLAUDE.md |
|---------|----------|---------|-----------|
| [finp2p-adapter-models](finp2p-adapter-models/) | `@owneraio/finp2p-adapter-models` | Domain types and service interfaces &mdash; the contract every adapter implements | [CLAUDE.md](finp2p-adapter-models/CLAUDE.md) |
| [skeleton](skeleton/) | `@owneraio/finp2p-nodejs-skeleton-adapter` | Express routes, API mapping, async workflow persistence, plugin system, default service implementations | [CLAUDE.md](skeleton/CLAUDE.md) |
| [finp2p-client](finp2p-client/) | `@owneraio/finp2p-client` | TypeScript client for the FinP2P router (REST + GraphQL) | [CLAUDE.md](finp2p-client/CLAUDE.md) |
| [adapter-tests](adapter-tests/) | `@owneraio/adapter-tests` | Reusable integration test suite for any adapter | [CLAUDE.md](adapter-tests/CLAUDE.md) |
| [sample-adapter](sample-adapter/) | `@owneraio/sample-adapter` | Reference implementation with in-memory storage | [CLAUDE.md](sample-adapter/CLAUDE.md) |

## Dependency graph

```
finp2p-adapter-models  (domain types, interfaces)
    |
    +---> skeleton  (framework: routes, workflows, plugins)
    |        |
    |        +---> finp2p-client  (router communication)
    |
    +---> adapter-tests  (integration tests)
    |        |
    |        +---> skeleton
    |
    +---> sample-adapter  (reference implementation)
             |
             +---> skeleton
             +---> adapter-tests  (dev dependency)
             +---> finp2p-client
```

## Versioning strategy

**Major.minor** version is correlated with the FinP2P router (node) version. For example, adapter packages at `0.27.x` are compatible with router `0.27.x`. Patch versions are for adapter-side changes that don't require router changes.

When the router releases a new version:
1. Update API specs in `skeleton/apis/` and `finp2p-client/apis/` from the router repo
2. Regenerate types (`npm run api-generate` in both)
3. Update interfaces in `finp2p-adapter-models` if needed
4. Bump versions and propagate dependencies

## Publishing

Each subproject has its own GitHub Actions workflow triggered by git tags:

| Tag pattern | Package published | Registry |
|-------------|------------------|----------|
| `finp2p-adapter-models-v*` | `@owneraio/finp2p-adapter-models` | npm public + GitHub Packages |
| `skeleton-v*` | `@owneraio/finp2p-nodejs-skeleton-adapter` | GitHub Packages |
| `finp2p-client-v*` | `@owneraio/finp2p-client` | GitHub Packages |
| `adapter-tests-v*` | `@owneraio/adapter-tests` | GitHub Packages |

**Publish order matters** due to dependencies: adapter-models first, then skeleton and finp2p-client, then adapter-tests, then sample-adapter.

## CI

The CI workflow (`.github/workflows/ci.yml`) runs on every PR and push to master. It builds and tests all subprojects in dependency order:
1. finp2p-client &rarr; build
2. finp2p-adapter-models &rarr; build
3. adapter-tests &rarr; build
4. skeleton &rarr; build + test (requires PostgreSQL via testcontainers + goose)
5. sample-adapter &rarr; build + test (requires PostgreSQL via testcontainers + goose)

## Development setup

Each subproject has its own `package.json` and `node_modules`. There is no workspace-level package manager &mdash; install and build each subproject independently.

```bash
# Build adapter-models (no external deps)
cd finp2p-adapter-models && npm install && npm run build

# Build skeleton (depends on published adapter-models + finp2p-client)
cd skeleton && npm install && npm run build

# Build and test sample-adapter (depends on all of the above)
cd sample-adapter && npm install && npm run build && npm test
```

For local development across subprojects, you can temporarily `npm install ../finp2p-adapter-models` etc., but **remember to restore the version range** in `package.json` before committing (the `file:` protocol breaks CI).

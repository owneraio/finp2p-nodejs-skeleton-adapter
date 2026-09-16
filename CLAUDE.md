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

The CI workflow (`.github/workflows/ci.yml`) runs on every PR and push to master. Each subproject runs in its **own independent job** &mdash; there is no shared build order and no local linking. Every job does `npm ci` (installing `@owneraio` dependencies from GitHub Packages at the versions pinned in that subproject's `package-lock.json`), then builds, then tests where applicable:

| Job | Steps |
|-----|-------|
| finp2p-client | build |
| skeleton | build + test (PostgreSQL via testcontainers + goose) |
| adapter-tests | build |
| vanilla-service | build + test (PostgreSQL via testcontainers + goose) |
| sample-adapter | build + test (PostgreSQL via testcontainers + goose) |

## Cross-project changes (why CI does not link local packages)

CI used to `npm install ../skeleton` etc., so downstream subprojects built against the sibling directory's working copy instead of a published package. That caused two problems:

1. **Duplicate nominal types.** The symlinked sibling brought its own nested copies of shared dependencies (`@owneraio/finp2p-client`, `pg`), which shadowed the consumer's copies and produced "two distinct nominal types" TypeScript errors &mdash; worked around with a fragile `npm prune --omit=dev` step.
2. **Untestable breaking changes.** When an upstream package (e.g. skeleton) made a breaking API change, downstream builds in the same PR only passed *because* of the local link. The PR would merge green, but the published downstream package was never actually built against a published upstream &mdash; forcing people to either publish prerelease versions mid-review or publish release versions straight from branches to untangle it.

CI now installs every subproject strictly from GitHub Packages. The workflow for a breaking cross-project change is:

1. Make the upstream change and open a PR (upstream's own build + tests validate it).
2. Publish a **prerelease** from the branch, e.g. tag `skeleton-v0.29.0-mychange.0` &rarr; publishes `@owneraio/finp2p-nodejs-skeleton-adapter@0.29.0-mychange.0`.
3. In the downstream subproject, point `package.json` at the prerelease, run `npm install` to update the lockfile, and make the adapting change. CI builds it against the real published prerelease.
4. After the upstream release version is published, bump the downstream range to it before (or when) merging.

Non-breaking changes need no coordination: merge upstream, publish, then bump the downstream version range in a follow-up.

## Development setup

Each subproject has its own `package.json` and `node_modules`. There is no workspace-level package manager &mdash; install and build each subproject independently.

```bash
# Build finp2p-client (no @owneraio deps)
cd finp2p-client && npm ci && npm run build

# Build skeleton (depends on published finp2p-client)
cd skeleton && npm ci && npm run build

# Build and test sample-adapter (depends on all of the above)
cd sample-adapter && npm ci && npm run build && npm test
```

All `@owneraio/*` dependencies resolve to **published packages on GitHub Packages** &mdash; never to sibling directories. Do not `npm install ../skeleton` or use `file:`/`link:` specifiers, even temporarily: the lockfile picks up the local paths and the build stops testing what will actually ship (see "Cross-project changes" above). If you need an unpublished sibling change, publish a prerelease and depend on that.

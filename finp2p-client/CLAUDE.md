# finp2p-client

> `@owneraio/finp2p-client` &mdash; Published to **GitHub Packages**

## Purpose

TypeScript client for communicating with the **FinP2P router (node)**. Used by the adapter skeleton and adapter implementations to:

- Fetch execution plans for validation during plan approval
- Send async operation callbacks to the router
- Query assets, profiles, organizations, and proof policies from the node's OSS (Object Storage Service)
- Import transactions
- Wait for operation completion (polling)

## Architecture

### FinAPI client (`src/finapi/`)

REST client for the FinP2P router's application and operational APIs:

- **`model-gen.ts`** &mdash; Types generated from the router's `application-api.base.yaml` OpenAPI spec
- **`op-model-gen.ts`** &mdash; Types generated from the router's `operational-api.yaml` OpenAPI spec (includes the `operationStatus` type used for callbacks)
- **`finapi.client.ts`** &mdash; `FinAPIClient` &mdash; HTTP client using `openapi-fetch`. Key methods: `createAsset`, `shareProfile`, `getOperationStatus`, `sendCallback`, `importTransactions`, `getExecutionPlan`, `waitForOperationCompletion`

### Investor network accounts (onboarding)

An investor can have an on-chain **network account** onboarded per `(organization, asset)`, which operation legs may then name explicitly via the optional `networkAccount` field on the shared account schemas.

| Method | Route |
|--------|-------|
| `createInvestorAccount` | `POST /profiles/investor/{investorId}/account/create` &mdash; adapter generates the account and holds the keys |
| `bindInvestorAccount` | `POST /profiles/investor/{investorId}/account/bind` &mdash; caller supplies an existing account + `ownershipSignature` |
| `submitAccountProof` | `POST /profiles/investor/{investorId}/account/proof` &mdash; fulfils a `signatureTemplate` challenge |
| `removeInvestorAccount` | `DELETE /profiles/investor/{investorId}/account/{accountId}` |

All four return `202 { cid }`. The ledger adapter then issues a **challenge**; poll `getOperationStatus(cid)` &mdash; while `isCompleted` is false the response carries `challenge`, and on completion it carries `{ id, networkAccount }`. Only the `signatureTemplate` variant round-trips through `submitAccountProof`; `walletConnect`, `deposit`, and `fireblocksApproval` are fulfilled out of band and the adapter reports verification directly.

Read the onboarded accounts back from the OSS side with `getOwnerNetworkAccounts(ownerId, { organizationId?, assetId? })`, which returns `OssInvestorNetworkAccount[]`. The `account` union is discriminated by `kind` (an alias of `__typename`) &mdash; not `type`, because `WalletAccount` already has a field called `type`.

Two things to know:

- **`Idempotency-Key` is required** on all four routes &mdash; they are the only application-API routes where it is not optional. The client defaults it to `generateNonce().toString('hex')`; every method takes an optional trailing `idempotencyKey` to override.
- **`walletAccount.type` must be exactly `'walletAccount'`.** The router compares the adapter's onboarding echo byte-for-byte against the account named on an operation leg, so any other token (e.g. `'wallet'`) causes a spurious 7351 `AccountNotWhitelisted` on every operation after a successful bind.

### OSS client (`src/oss/`)

GraphQL client for the router's Object Storage Service:

- **`oss.client.ts`** &mdash; `OssClient` &mdash; queries assets, payment assets, owners, organizations, balances
- **`model.ts`** &mdash; Domain types for OSS responses (assets, proof policies, proof domains)
- **`graphql.d.ts`** &mdash; Generated GraphQL type definitions

### Unified client (`src/client.ts`)

`FinP2PClient` &mdash; combines both FinAPI and OSS clients into a single facade. This is what adapter code typically imports:

```typescript
const client = new FinP2PClient(finAPIUrl, ossUrl);
await client.getExecutionPlan(planId);
await client.sendCallback(cid, operationStatus);
await client.getAssetProofPolicy(assetCode, assetType, paymentOrgId);
```

## API spec management

Specs come from **two** upstream repos &mdash; a frequent source of confusion:

| File(s) | Source |
|---------|--------|
| `application-api.base.yaml`, `common-external-components.yaml`, `operational-api.yaml` (from `operational-api.gen.yaml`), `dlt-adapter-api.yaml`, `custody-adapter-api.yaml` | `owneraio/finp2p-core` &rarr; `api/` |
| `ownership.graphql` | `owneraio/oss` &rarr; `graphql/ownership.graphql` |

```bash
npm run api-generate       # application API types
npm run op-api-generate    # operational API types (with post-processing)
npm run graphql-gen        # GraphQL types from the vendored schema
npm run generate-all       # all of the above
npm run validate:graphql   # validate OSS queries against the schema (no output)
npm run smoke              # wire-level checks; needs `npm run build` first
```

The operational API post-processor (`scripts/postprocess-model-gen.ts`) handles the same circular reference and export issues as the skeleton's post-processor.

**Re-sync `ownership.graphql` wholesale; never hand-edit it to match a query.** It is the only thing that constrains the OSS queries, so a hand-patched schema silently legitimises a broken selection set. `prebuild` runs `validate:graphql`, which checks every document in `src/oss/graphql/` against it and fails the build with a file:line pointer &mdash; so `npm run build` (what CI runs) catches a query/schema mismatch. `graphqlvalidate.ts` must keep the same `schema` and `documents` as `grahpqlgen.ts`.

`dlt-adapter-api.yaml` and `custody-adapter-api.yaml` are reference copies only &mdash; no script generates from them, so nothing detects their drift. Re-sync them by hand when consulting them.

### OSS version floor

The OSS `NetworkAccount` was an object with a `wallet` field until [oss#557](https://github.com/owneraio/oss/pull/557) (2026-07-29) turned it into a `union NetworkAccount = WalletAccount | Caip10Account | CustodialAccount`. The two forms are mutually exclusive, so the queries here **require OSS at or past that commit**; against an older deployment they fail with `Cannot query field ... on type "NetworkAccount"`. If you ever need to target a pre-#557 router, revert the vendored schema and all three selections together &mdash; `owners.graphql`, `receipts.graphql`, `plans.graphql` &mdash; not just one.

## Build & publish

```bash
npm run build   # tsc + copy .graphql files to dist/
```

Publish is triggered by git tag `finp2p-client-v*`.

## Versioning

Major.minor correlates with the FinP2P router version. The client's API types must match the router version it communicates with.

## See also

- [Top-level CLAUDE.md](../CLAUDE.md) &mdash; monorepo overview
- [skeleton/CLAUDE.md](../skeleton/CLAUDE.md) &mdash; uses this client for plan approval, proof generation, and callbacks
- [finp2p-adapter-models/CLAUDE.md](../finp2p-adapter-models/CLAUDE.md) &mdash; domain model (the client provides router-side types, adapter-models provides adapter-side types)

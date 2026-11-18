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

### Move intents (`src/flows.ts`)

A **move** converts one holder's position from one asset into another. Same beneficial owner on both sides, so there is no counterparty and no settlement leg.

| Helper | Does |
|--------|------|
| `createMoveIntent` | `POST /profiles/asset/{sourceAsset.id}/intent` with a `moveIntent`, declaring the migration path (source asset plus the destinations it may convert into). No quantity. |
| `executeMoveIntent` | `POST /tokens/execute` with a `moveIntentExecution`. Returns the execution plan id. |
| `createMovePolicy` | The policy that makes a move ONE `Move` instruction. |

Node rules the helpers cannot check for you:

- **A move intent is a singleton per source asset.** A second create on the same source asset is a conflict, not an extra path.
- **Source and destination finId must be equal.** A move converts a position, it does not change who holds it. `executeMoveIntent` builds both accounts from the one `owner`, so this can only break if you reach past it.
- **Both assets need the same non-empty `financialIdentifier`.** On release-v0.29 only ISIN, ISO4217 and NONE are accepted, so an asset identified by a CUSIP needs an ISIN derived from it before the pair will match.
- **The seeded default move policy is hold-issue-redeem,** which decomposes a move into three instructions. A plan that should be a single Move needs `createMovePolicy`.

Two details worth knowing:

- **`executeMoveIntent` uses `generateNonce()`, not `hexNonce()`.** The spec's `nonce` is 32 bytes, 24 random plus an 8-byte big-endian epoch-seconds tail. `hexNonce()` is 16 random bytes with no timestamp. Every older execute helper in this file uses `hexNonce()` and the node has not enforced the constraint on them, so they were left alone rather than changed under working flows &mdash; but new helpers follow the spec.
- **`createMovePolicy`'s default instruction is the body a release-v0.29 node accepts,** confirmed end to end against a live node. Two things in it are load-bearing and were wrong in `0.29.2-rc.1`:
  - **No `executors`.** An instruction carrying both `target` and `executors` is refused with `1300 instruction 1 cannot have both target and executors defined`, and the target is what scopes this one.
  - **`target.version: 'v1'`.** Optional in the schema, present on the policy the node accepted.
  - `failed` rather than `halted` on failure is deliberate: a conversion is atomic, so nothing is parked to unwind, and `halted` belongs to a Hold.
- **`priority` is required and has no default.** It must be unique among a node's policies for the same intent; a duplicate is refused with `4101`. Any fixed default therefore works exactly once per node and then collides, which is why there is none. Use a value above 1000 to outrank the seeded hold-issue-redeem policy. It is checked at runtime as well as in the type, because this package is consumed from JavaScript suites where the type is invisible.
- **The smoke test asserts the default instruction WHOLE, not field by field.** Both rc.1 bugs were in fields no partial assertion was looking at. A recording server can only check the bytes against what you believed; it cannot tell you the node disagrees. Anything new that only a real node can reject belongs in E2E's run, not here.
  - **Scope the policy with a tight `assetMatchingCriteria` name regexp.** A broad one turns every move on the node into a single `Move`, including ones that wanted hold-issue-redeem.
  - **Adapter capabilities, once finp2p-core #2853 lands.** A policy then attaches only if the adapter's capability list covers its instructions, and a move is checked on **both** sides, source and destination. An adapter reporting no list is read as supporting the full instruction set, so an adapter that has not adopted the capability API keeps attaching everything; an explicit empty list means nothing attaches. The list is served by the adapter over the DLT adapter API (optional `capabilities` on the create-asset response, plus `POST /assets/getCapabilities`), not on a ledger binding or a registration template. Entries are `{instruction: 'INSTRUCTION_MOVE', contracts?: [...]}`; `INSTRUCTION_AWAIT` is rejected. #2853 also moves the router's default protocol version from 3 to 4.

**`OpRequestBody` used to resolve to `never`** for any path whose `requestBody` is optional in the generated types (`requestBody?:`), which silently made `createPolicy` uncallable with any body at all. It now infers through the optional. If a client method takes a body and TypeScript insists the argument is `never`, that is the bug to look for.

### Repo agreements (`src/repo/`)

`RepoAgreementsClient` &mdash; the router's repo facade, mirroring `io.ownera.finp2p.repo.RepoAgreementsClient` in the Java SDK. A standing agreement is proposed once and every later trade cites its id.

| Method | Route |
|--------|-------|
| `proposeAgreement` | `POST /repo/agreements` &rarr; `{ agreementId }` |
| `approveAgreement` | `POST /repo/agreements/{id}/approve` &mdash; body `{ role, agreementVersion }` |
| `rejectAgreement` | `POST /repo/agreements/{id}/reject` &mdash; body `{ role, reason? }` |
| `agreementAction` / `terminate`, `serveDefaultNotice`, &hellip; | `POST /repo/agreements/{id}/{action}` |
| `openTrade`, `tradeAction` and its aliases | `POST /repo/agreements/{id}/trades[/{tradeId}/{action}]` |
| `reportAction` / `proposeLines`, `setReportStatus` | `POST /repo/agreements/{id}/reports/{reportEventId}/{action}` |
| `proposalAction` / `approveLines`, `postLine`, &hellip; | `POST /repo/agreements/{id}/reports/_/proposals/{proposalEventId}/{action}` |
| `closeBasket` | `POST /repo/agreements/{id}/baskets/{basketId}/close` |

Things that are easy to get wrong:

- **`reject` is not `approve` with a different verb.** Approve carries `agreementVersion`; reject carries `reason`. Sending the approve body to reject silently drops the reason.
- **Role values are kebab-case on the wire** (`valuation-engine`, `calculation-agent`) while the `parties` field names are camelCase (`valuationEngine`). The two are deliberately not the same strings.
- **The `_` in the proposal route is literal.** The facade reads the proposal off the log by its event id, so the report segment is informational and must not be filled in.
- **`Idempotency-Key` is sent on every command**, defaulted to a fresh 32-byte hex nonce. A fresh key per call gives no deduplication on retry &mdash; if you own the retry loop, mint one key and pass it to every attempt.
- **`pathSegment` refuses rather than escapes.** An id that is empty, `.`, `..`, or contains `/`, `\` or `%` throws instead of being encoded, because the router decodes the path a second time and an escaped separator would become a separator after all. `:` is left literal. This is ported from the Java SDK and the two must agree &mdash; the same id has to address the same resource from either.

**Terms and documents are open objects** (`Record<string, unknown>`), not generated or hand-ported types. Two reasons, and both matter:

1. The repo facade is **not in `application-api.base.yaml`**. It lives on `feature/agreement-repo` in finp2p-core and is not on master, so there is no spec to generate from. Generating from a moving feature branch would make every core commit a release of this package.
2. The Java SDK's `RepoTerms` is **behind core** &mdash; no `eligibleAssets`, `cashCurrency`, `collateralPlatform`, `addressBook` or `haircutConvention`, all of which callers send today. Copying it would have shipped a type that rejects valid payloads.

Terms are opaque to the network &mdash; the router stores them base64-encoded and parses nothing &mdash; so typing them here buys no safety. Name the shape in your own code if you want one.

### Reading agreements back (`OssClient`)

| Method | Purpose |
|--------|---------|
| `getAgreements(filter?, paginate?, orderBy?)` | Raw lookup over the `agreements` query |
| `getAgreement(id)` | One agreement, or `ItemNotFoundError` |
| `findActiveAgreementsBetween(partyA, partyB, opts?)` | The "did we already set one up?" lookup |

- **`agreements` is a top-level query field**, not `repo.agreements`. `repo` is the application vocabulary written into `termsType`, not a GraphQL namespace; the same query serves every agreement type.
- **Filter keys address top-level fields of the record** &mdash; `id`, `organizationId`, `status`, `businessState`, `version`, `termsType`, `validFrom`, `validUntil`, `createdAt`, `updatedAt`. A key naming no field at all **fails the whole query** rather than returning nothing, so never guess one. `findActiveAgreementsBetween` therefore filters `status` and `termsType` server-side and matches the parties client-side against `roles[].parties` &mdash; which means `paginate.limit` bounds the rows *scanned*, not the rows returned.
- **`terms` comes back base64-encoded**, while the write side takes a JSON object. The asymmetry is the router's, not this client's. Decode with `decodeAgreementTerms(agreement)`, which returns `undefined` rather than throwing on a payload it cannot parse &mdash; terms belong to whichever application owns `termsType`, and a scan over many agreements must not die on one bad row.
- **An empty `rejections` says nothing on its own.** Non-empty implies `AGREEMENT_STATUS_REJECTED`, but an agreement may also be `AGREEMENT_STATUS_TERMINATED` by running its course. The two terminal statuses mean opposite things.

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

`apis/ownership.graphql` was re-synced wholesale from `owneraio/oss` master on 2026-11-15 to pick up the `agreements` query (2340 &rarr; 3245 lines). Every pre-existing document still validates against it, so the re-sync broke nothing &mdash; but the floor moved: the queries here now require an OSS deployment that has `agreements`, and `src/oss/graphql/agreements.graphql` fails against an older one.

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

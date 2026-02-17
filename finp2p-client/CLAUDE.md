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

Specs are sourced from the FinP2P router repo (`apis/` directory):

```bash
npm run api-generate       # application API types
npm run op-api-generate    # operational API types (with post-processing)
npm run graphql-gen        # GraphQL types from .graphql schema files
npm run generate-all       # all of the above
```

The operational API post-processor (`scripts/postprocess-model-gen.ts`) handles the same circular reference and export issues as the skeleton's post-processor.

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

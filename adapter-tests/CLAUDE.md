# adapter-tests

> `@owneraio/adapter-tests` &mdash; Published to **GitHub Packages**

## Purpose

Reusable **integration test suite** for FinP2P ledger adapters. Any adapter built on the skeleton can import this package and run the full test suite against its implementation to verify correctness. This ensures all adapters conform to the same behavioral contract.

## How it works

The test suite is published as an npm package. An adapter project (like `sample-adapter`) imports and invokes it in a single line:

```typescript
// tests/adapter.test.ts
import { runAdapterTests } from "@owneraio/adapter-tests";
runAdapterTests();
```

The test environment (provided by the adapter project, not this package) is responsible for:
1. Starting a database (typically PostgreSQL via testcontainers)
2. Creating and starting the adapter Express app
3. Exposing `global.serverAddress` for the test client to connect to

## Test suites

### Token lifecycle (`src/token-lifecycle.test.ts`)
End-to-end flow: create asset, issue tokens, transfer between accounts, verify balances.

### Business logic (`src/business-logic.test.ts`)
Comprehensive tests including:
- Issue and redeem flows
- Escrow operations (hold, release, rollback)
- Negative tests: rollback of released holds, double operations, wrong actor scenarios
- Partial release of held funds

### Insufficient balance (`src/insufficient-balance.test.ts`)
Validates error handling when operations exceed available balances.

## Test infrastructure

### API client (`src/api/`)

- **`api.ts`** &mdash; Typed HTTP client classes mirroring the DLT adapter API:
  - `TokensLedgerAPI` &mdash; create, issue, redeem, transfer
  - `EscrowLedgerAPI` &mdash; hold, release, rollback
  - `PaymentsLedgerAPI` &mdash; deposit instruction, payout
  - `PlanLedgerAPI` &mdash; approve, proposal, proposal status
  - `CommonLedgerAPI` &mdash; receipts, operation status, balance
  - `LedgerAPIClient` &mdash; unified facade with helper methods like `expectBalance()`
- **`base.ts`** &mdash; `ClientBase` with axios HTTP methods and optional OpenAPI validation
- **`mapper.ts`** &mdash; Test data mapping utilities

### Test utilities (`src/utils/`)

- **`test-builders.ts`** &mdash; `TestDataBuilder` for constructing signed requests (uses secp256k1)
- **`test-fixtures.ts`** &mdash; `TestFixtures` for common setup scenarios (issued tokens, held funds)
- **`test-assertions.ts`** &mdash; `ReceiptAssertions` for validating receipt structure
- **`test-constants.ts`** &mdash; Addresses, amounts, scenario parameters
- **`openapi-validator.ts`** &mdash; Optional request/response validation against the OpenAPI spec

### Callback server (`src/callback-server/`)

Mock callback server for testing async operation flows (callback response strategy).

## Build & publish

```bash
npm run build   # tsc
```

Publish is triggered by git tag `adapter-tests-v*`.

## See also

- [Top-level CLAUDE.md](../CLAUDE.md) &mdash; monorepo overview
- [sample-adapter/CLAUDE.md](../sample-adapter/CLAUDE.md) &mdash; uses this test suite
- [skeleton/CLAUDE.md](../skeleton/CLAUDE.md) &mdash; the framework these tests validate
- [finp2p-adapter-models/CLAUDE.md](../finp2p-adapter-models/CLAUDE.md) &mdash; types used by the API client

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

### Swap operations (`src/swap-operations.test.ts`)
Opt-in via `runAdapterTests({ swap: true })`. Exercises `POST /assets/swap` with `numberOfReceipts` 2 (both legs, two receipts sharing one `transactionId`) and 1 (asset leg only), cross-org bindings (each account carries its holder's org resource id; receipts echo the counterparty id on the side it holds &mdash; destination on the sent leg, source on the received one; requires skeleton &ge; 0.29.1), plus deadline rejection.

### Asset capabilities (`src/capabilities.test.ts`)
Opt-in via `runAdapterTests({ capabilities: true })`; off by default, so adapters that do not report capabilities run exactly the suites above. For adapters implementing `TokenService.getCapabilities` (requires skeleton &ge; 0.29.5). Covers:
- create asset returns a valid capability list (instruction ids, contracts as `address` + `addressFormat` with the address valid for its format and no two contracts of one instruction equal after normalizing, amount limits)
- `POST /assets/getCapabilities` returns the list reported at creation (addresses compared after normalizing), and answers 404 for an unknown asset
- a transfer whose `executionContext.contract` is a listed address runs, so does one with another spelling of it (caip10 and url addresses; opaque has one spelling; the router sends the first asset's spelling in swaps), and one with an unlisted address is refused without moving funds

Contracts have no names. The router stores the address as the adapter sent it, sends it back in `executionContext.contract`, and compares two addresses after normalizing by `addressFormat`: caip10 lowercases the namespace and an eip155 account (0x plus 40 hex digits), keeping the rest; url lowercases scheme and host, drops the default http and https port, normalizes percent-encoding and dot segments, makes an empty path `/` and rejects fragments and user info; opaque is exact. Formats must match; an address that does not parse equals only the identical string (`src/utils/contract-address.ts`, also exported as `contractAddress`; it mirrors the router's `contractaddress` package).

The adapter must list at least one contract for `INSTRUCTION_TRANSFER` and refuse a contract address its asset does not list. The 501 an adapter without `getCapabilities` answers is covered by the skeleton's own route tests.

## Test infrastructure

### API client (`src/api/`)

- **`api.ts`** &mdash; Typed HTTP client classes mirroring the DLT adapter API:
  - `TokensLedgerAPI` &mdash; create, issue, redeem, transfer, swap, getCapabilities
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

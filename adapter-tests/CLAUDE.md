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
Opt-in via `runAdapterTests({ capabilities: true })`, with `contractTransfers: false` for an adapter that lists no admitting TRANSFER contract; off by default, so adapters that do not report capabilities run exactly the suites above. For adapters implementing `TokenService.getCapabilities` (requires skeleton &ge; 0.29.7). Covers:
- create asset returns a valid capability list (instruction ids, contracts as `address` + `addressFormat` with the address valid for its format and no two contracts of one instruction equal after normalizing, amount limits)
- `POST /assets/getCapabilities` returns the list reported at creation (addresses compared after normalizing), and answers 404 for an unknown asset
- contract transfers (skipped when `contractTransfers: false`): a transfer whose `executionContext.contract` is a listed address runs, so does one with another spelling of it (caip10 and url addresses; opaque has one spelling; the router sends the first asset's spelling in swaps), and one with an unlisted address is refused without moving funds

Contracts have no names. The router stores the address as the adapter sent it, sends it back in `executionContext.contract`, and compares two addresses after normalizing by `addressFormat`. Every format: at most 1024 bytes, valid UTF-8, no control or format characters (a byte order mark included). caip10 lowercases the namespace and an eip155 account (0x plus 40 hex digits) and needs a decimal eip155 chain reference without leading zeros, keeping the rest. url lowercases the scheme and the ASCII letters of the host (other host characters stay as written), strips leading zeros from the port, rejects a port above 65535 and drops the default http and https port; an http or https URL needs a host; a bracketed host must be an IPv6 literal; an escaped host must decode to valid text; dot segments are kept, not resolved, so `/a/../b` and `/b` differ; it normalizes percent-encoding in the path (non-ASCII characters are escaped) and in the opaque part of a URL such as `mailto:`, makes an empty path `/`, keeps the query as sent, and rejects fragments, user info, an unbracketed host with more than one colon and invalid percent escapes in the query or opaque part; opaque is exact. Formats must match; an address that does not normalize equals nothing, not even itself (`src/utils/contract-address.ts`, also exported as `contractAddress`; it mirrors the router's `contractaddress` package). Amount limits are compared as exact decimals (`src/utils/decimal.ts`, exported as `decimal`), never as numbers.

An adapter may list `INSTRUCTION_TRANSFER` with no contracts, meaning the instruction runs without one. The three contract-transfer tests above (listed address, respelled address, unlisted address refused) need a TRANSFER contract whose `minAmount` and `maxAmount` admit the amount sent (10, compared exactly); the first such contract is used. An adapter without one sets `contractTransfers: false`, and the three tests are reported as skipped; left at the default, they fail naming the reason. The respelled-address test still ends without sending when the contract is opaque, which has one spelling. The unlisted address is well formed in the used contract's format (a caip10 address keeps its namespace and reference, a url is an `.invalid` host), so only a check against the list refuses it. An adapter that lists a contract for TRANSFER must refuse a contract address its asset does not list. The 501 an adapter without `getCapabilities` answers is covered by the skeleton's own route tests.

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

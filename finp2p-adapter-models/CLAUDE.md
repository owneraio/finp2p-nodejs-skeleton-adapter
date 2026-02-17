# finp2p-adapter-models

> `@owneraio/finp2p-adapter-models` &mdash; Published to both **npm public** and **GitHub Packages**

## Purpose

Domain model and service interfaces for FinP2P ledger adapters. This is the **contract layer** that every adapter must implement. It decouples the adapter skeleton (HTTP routing, workflow persistence) from the ledger-specific logic, so that building a new adapter boils down to implementing a handful of service interfaces.

## What's inside

### Domain types (`src/model.ts`)

Platform-neutral types that mirror the FinP2P protocol concepts without leaking OpenAPI specifics:

- **Asset model** &mdash; `Asset`, `AssetType`, `DepositAsset`, identifiers (ISIN, CUSIP, DTI, etc.), denominations
- **Accounts** &mdash; `FinIdAccount`, `CryptocurrencyWallet`, `IbanIdentifier`, `Source`, `Destination`
- **Execution plans** &mdash; `ExecutionPlan`, `ExecutionInstruction`, `ExecutionPlanOperation` (hold, release, issue, transfer, await, revertHold, redeem) and plan investor/contract types
- **Plan proposals** &mdash; `PlanProposal` discriminated union: `cancel`, `reset` (to a specific instruction), `instruction` (per-instruction approval)
- **Operation results** &mdash; Each operation category has a success/failure/pending tri-state:
  - `ReceiptOperation` &mdash; for issue, transfer, redeem, hold, release, rollback, payout
  - `AssetCreationStatus` &mdash; for createAsset
  - `PlanApprovalStatus` &mdash; approved/rejected/pending for plan operations
  - `DepositOperation` &mdash; for payment deposits
- **Signatures & Proofs** &mdash; `Signature`, `SignatureTemplate` (hashList or EIP712), `ProofPolicy`
- **Receipts** &mdash; `Receipt` with full transaction/trade details and proof

### Service interfaces (`src/interfaces.ts`)

These are the interfaces adapter developers implement. Each maps to a ledger capability:

| Interface | Capability | Methods |
|-----------|-----------|---------|
| `TokenService` | Token lifecycle | `createAsset`, `issue`, `transfer`, `redeem`, `balance`, `getBalance` |
| `EscrowService` | Escrow operations | `hold`, `release`, `rollback` |
| `PaymentService` | Fiat/crypto payments | `getDepositInstruction`, `payout` |
| `PlanApprovalService` | Execution plan control | `approvePlan`, `proposeCancelPlan`, `proposeResetPlan`, `proposeInstructionApproval`, `proposalStatus` |
| `CommonService` | Cross-cutting | `getReceipt`, `operationStatus` |
| `HealthService` | Health checks | `liveness`, `readiness` |

### Plugin interfaces (`src/plugins/`)

Extension points for cross-cutting concerns (sync and async variants):

- `PlanApprovalPlugin` / `AsyncPlanApprovalPlugin` &mdash; validate issuance/transfer/redemption within a plan
- `PaymentsPlugin` / `AsyncPaymentsPlugin` &mdash; deposit/payout logic
- `AssetCreationPlugin` / `AsyncAssetCreationPlugin` &mdash; post-creation validation
- `TransactionHook` &mdash; pre/post transaction hooks
- `LedgerCallbackService` &mdash; async operation result delivery

### Utilities

- `src/eip712.ts` &mdash; EIP-712 typed data structures
- `src/hashList.ts` &mdash; Hash list signature computation
- `src/utils.ts` &mdash; Correlation ID generation, helpers
- `src/errors.ts` &mdash; `BusinessError`, `ConfigurationError`, `ValidationError`
- `src/logger.ts` &mdash; Logger interface

## Versioning

Major.minor version is correlated with the FinP2P router (node) version (e.g. adapter-models 0.27.x is for router 0.27.x). Patch versions are for adapter-side changes that don't require router changes.

## Build & publish

```bash
npm run build   # tsc
```

Publish is triggered by git tag `finp2p-adapter-models-v*`. Publishes to **both** public npm (`@owneraio/finp2p-adapter-models`) and GitHub Packages.

## See also

- [Top-level CLAUDE.md](../CLAUDE.md) &mdash; monorepo overview and dependency graph
- [skeleton/CLAUDE.md](../skeleton/CLAUDE.md) &mdash; consumes these interfaces for HTTP routing and workflow persistence
- [sample-adapter/CLAUDE.md](../sample-adapter/CLAUDE.md) &mdash; reference implementation of these interfaces

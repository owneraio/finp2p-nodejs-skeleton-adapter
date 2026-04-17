# Discussion: Suggested Adapter Account Model And Current Account Mapping Procedure

## Summary

This note proposes a cleaner adapter-local account model for FinP2P adapters.

The main idea is:

- at the adapter boundary, a `finId` should be treated as a managed account handle
- inside the adapter, that handle must be resolved into a concrete internal ledger account identifier
- external counterparties should be modeled explicitly as external endpoints, not squeezed into the same shape as managed accounts

This document also records the account-mapping procedure currently implemented in the skeleton.

## Why This Discussion Matters

The current skeleton model mixes several concerns:

- owner identity
- whether the adapter controls an account
- the actual internal ledger account used for execution
- external settlement endpoints such as wallets or bank accounts

In practice, these are not the same thing.

For a real adapter:

- a request source that arrives at our adapter is generally an account under our control
- that source is referred to by `finId` at the API boundary
- the adapter implementation must resolve that `finId` to a concrete internal ledger account identifier
- the destination may be:
  - another managed account under our control
  - a known counterparty with a `finId`
  - a counterparty identified only by `orgId`
  - a purely external endpoint such as a blockchain wallet address

That means the adapter benefits from a simpler canonical model than the current wire-facing FinP2P shape.

## Current Skeleton Model

Today the shared skeleton model is roughly:

```ts
type FinIdAccount = {
  finId: string;
  orgId: string;
  custodianOrgId: string;
};

type Source = {
  finId: string;
  account?: LedgerAccount;
};

type Destination = {
  finId: string;
  account?: LedgerAccount;
};

type LedgerAccount = {
  type: string;
  address: string;
};
```

Operationally, this means:

- `finId` is always present on `Source` and `Destination`
- an optional `ledgerAccount` can carry extra information such as a wallet address
- the model does not explicitly distinguish between:
  - a managed account we can execute against
  - an external counterparty endpoint

This is workable for backward compatibility, but it is not the clearest adapter-local abstraction.

## Suggested Adapter-Local Interpretation

Within a concrete adapter, `finId` should be interpreted as:

- a stable managed account handle presented at the API boundary
- not the final internal ledger account identifier

That distinction is important.

A `finId` says:

- "this operation is for an account we manage or can act for"

It does not necessarily say:

- "this exact string is the account id used by the underlying ledger"

The adapter must still resolve `finId` into one or more internal ledger identifiers depending on context.

## Suggested Canonical Account Model

The adapter should normalize incoming API requests into a simpler internal model.

Recommended shape:

```ts
type PartyRef = {
  finId?: string;
  orgId?: string;
};

type ManagedAccountRef = {
  kind: 'managed';
  finId: string;
};

type ExternalEndpoint =
  | {
      type: 'wallet';
      address: string;
      network?: string;
    }
  | {
      type: 'bank';
      method: PaymentMethodInstruction;
    }
  | {
      type: 'other';
      value: string;
    };

type ExternalAccountRef = {
  kind: 'external';
  counterparty?: PartyRef;
  endpoint: ExternalEndpoint;
};

type AccountRef = ManagedAccountRef | ExternalAccountRef;
```

This keeps the important distinction explicit:

- `managed`: we can execute against it after local resolution
- `external`: we cannot execute against it directly as an internal account

## Suggested Resolution Model

For managed accounts, the adapter should perform a separate resolution step:

```ts
type ResolvedManagedAccount = {
  finId: string;
  internalAccountId: string;
  purpose?: string;
  assetId?: string;
  network?: string;
};
```

Resolution is intentionally a separate concern from request modeling.

That helps keep a clean boundary:

- request model: what the caller meant
- resolution model: what the ledger needs

## Operation Invariants

The following invariants are a good fit for adapter implementations.

### Source-side invariants

For operations that spend, hold, release, or redeem value on our venue, the source should always be managed:

- `transfer.source`
- `hold.source`
- `release.source`
- `rollback.source`
- `redeem.source`
- `payout.source`

This means these operations should enter adapter business logic as:

```ts
type ManagedSource = {
  kind: 'managed';
  finId: string;
};
```

### Destination-side invariants

The destination may be either:

- a managed account under our control
- an external endpoint

This applies to:

- `issue.destination`
- `transfer.destination`
- `release.destination`
- `payout.destination`

### Counterparty identity

For external destinations, counterparty identity may be partially known:

- `finId` may be known
- only `orgId` may be known
- neither may be known, and only the endpoint is available

So the adapter-local model should not require `finId` for external endpoints.

## Recommended Boundary Between Wire Model And Adapter Model

The current FinP2P HTTP/OpenAPI model should remain a compatibility layer for now.

Recommended boundary:

1. Accept the existing FinP2P wire model at the route layer.
2. Normalize it into the adapter canonical model.
3. Perform managed-account resolution inside the adapter service layer.
4. Keep the underlying ledger integration free from FinP2P-specific wire quirks.

This avoids forcing the unfinished or backward-compatible parts of the FinP2P model deep into adapter business logic.

## Current Account Mapping Procedure In The Skeleton

The skeleton already provides an owner-mapping flow that associates a `finId` with adapter-specific fields.

The current shape is:

- `finId`
- `status`
- `accountMappings: Record<string, string>`

The mapping API is intentionally generic:

- field names are adapter-defined
- examples include `ledgerAccountId`, `custodyAccountId`, and similar values

## Current Mapping Endpoints

The implemented endpoints are:

- `POST /mapping/owners`
- `GET /mapping/owners`
- `GET /mapping/fields`

### `POST /mapping/owners`

Purpose:

- create or update a mapping for a managed owner
- optionally disable a mapping by sending `status: inactive`

Expected request:

```json
{
  "finId": "<hex>",
  "status": "active",
  "accountMappings": {
    "ledgerAccountId": "abc123"
  }
}
```

### `GET /mapping/owners`

Purpose:

- query all owner mappings
- or filter by comma-separated `finIds`

### `GET /mapping/fields`

Purpose:

- return adapter-specific field metadata so callers know which mapping keys are supported

## Current Mapping Procedure Step By Step

The current procedure in the skeleton is:

1. The adapter exposes supported field metadata through `GET /mapping/fields`.
2. A caller submits `finId`, `status`, and `accountMappings` to `POST /mapping/owners`.
3. The route validates:
   - `finId` is present
   - `accountMappings` is present and non-empty
   - `finId` is hex
   - `status` is either `active` or `inactive`
4. If `status` is `inactive`, the mapping is deleted for that `finId`.
5. If a validator hook exists, the adapter validates and may transform the submitted mapping fields.
6. The mapping is persisted.
7. If a post-save hook exists, the adapter may perform additional provisioning work, such as creating an on-ledger credential.
8. The resulting mapping is returned to the caller.

## Current Storage Behavior

Mappings are stored as:

- one logical owner mapping per `finId`
- each field persisted as a separate row keyed by:
  - `fin_id`
  - `field_name`
  - `value`

Important current behavior:

- values are lowercased before persistence
- reverse lookup by field value is supported
- deleting a mapping can remove:
  - all fields for a `finId`
  - one specific field for a `finId`

## Current Hook And Validator Model

The mapping flow already supports two useful extension points.

### Validator

The validator can:

- reject invalid mappings
- normalize or transform fields before persistence

This is the right place for checks like:

- address format validation
- required field combinations
- network-specific account rules

### After-save hook

The after-save hook can:

- provision adapter-side or ledger-side credentials
- return extra response fields such as:
  - `credentialCid`
  - `credentialStatus`

This is useful when mapping creation must also create some ledger-level identity or permission artifact.

## Recommended Role Of Account Mapping Under The Suggested Model

Under the suggested adapter-local model, account mapping should apply only to managed accounts.

That means:

- mapping is for `ManagedAccountRef`
- mapping is not for arbitrary external destinations

In other words:

- `finId -> internal adapter account data`
- not `external wallet -> managed owner`

This leads to a clean rule:

- if an account is managed, resolve it through account mapping
- if an account is external, carry its endpoint directly in the request or plan context

## What Account Mapping Should Resolve

At minimum, account mapping should be able to answer:

- which internal ledger account belongs to this managed `finId`

In practice, real adapters often need more than one internal account per `finId`.

Examples:

- custody account
- omnibus account
- settlement account per asset
- settlement account per network
- fee or gas wallet
- subaccount or venue-specific account

That means a flat `Record<string, string>` is useful, but may not be sufficient forever.

## Likely Next Step For Mapping Evolution

If adapters need multi-account resolution, the next evolution may be:

- keep `finId` as the owner key
- keep the public mapping API backward-compatible
- define stronger conventions for field names or structured values

Possible patterns:

- fixed semantic keys such as:
  - `custodyAccountId`
  - `settlementAccountId`
  - `gasWalletAddress`
- contextual keys such as:
  - `erc20.mainnet.wallet`
  - `usd.swift.accountId`
- structured JSON values stored behind a single field

This should be decided separately from the core account model discussion, but it follows naturally from the same problem.

## Open Questions

The following questions remain open.

### 1. How much of the new model should become shared skeleton API?

Options:

- keep the richer account model adapter-local only
- introduce it into shared skeleton types

The safer path is usually:

- normalize at the adapter boundary first
- promote into shared skeleton types only after a few adapters confirm the model

### 2. Should external counterparty `finId` remain optional?

Recommended answer:

- yes

A counterparty may be known only by `orgId` and wallet, or only by wallet.

### 3. Should proofs and receipts keep using `finId`-only account encoding?

Today some proof-related code effectively collapses account identity back to `finId`.

If external endpoint identity becomes more important in receipts or proofs, that area may need a follow-up redesign.

### 4. Should `issue.destination` allow purely external endpoints?

This likely depends on adapter capabilities.

Some adapters may only issue to managed accounts.
Others may support direct issuance to an external wallet endpoint.

That should be a capability-level decision, not a global assumption baked into the core account model.

## Recommended Direction

Recommended near-term direction:

1. Keep the current FinP2P HTTP model for compatibility.
2. Introduce a clearer adapter-canonical account model internally:
   - `managed`
   - `external`
3. Treat `finId` as the managed account handle at the adapter boundary.
4. Resolve managed `finId` values into internal ledger account ids through account mapping plus adapter-specific logic.
5. Keep external endpoints explicit and outside the mapping flow.

This gives adapters a much clearer mental model without forcing an immediate protocol change.

## Review Notes

### On the ManagedAccountRef / ExternalAccountRef union

The `ManagedAccountRef` / `ExternalAccountRef` / `AccountRef` union with the `kind` discriminator is adapter-internal modeling. It should not be in the skeleton's shared types. The skeleton should stay at the wire-boundary level:

```ts
type Source = { finId: string };
type Destination = {
  orgId: string;
  finId?: string;
  account?: LedgerAccount;  // wallet address from the router
};
```

The adapter then decides internally whether this is "managed" or "external" based on its own logic (e.g., `orgId === myOrgId` means managed, otherwise external). The skeleton does not need to make that judgment.

### On the ExternalEndpoint union

The structured `ExternalEndpoint` union (`wallet` | `bank` | `other`) is premature for skeleton-level types. Today the API sends `LedgerAccount = { type: string; address: string }`. The adapter can interpret `type` however it wants. Adding structured variants now would be speculative.

### On orgId in service-level types

`orgId` and `custodianOrgId` are not needed at the service level (`Source`/`Destination`). The adapter implicitly knows:

- Source is always our org — we know who we are.
- Destination is either our account (we check mapping by `finId`) or external (we get the wallet address). The adapter does not need `orgId` to decide that. The FinP2P API may not even provide these details during ledger requests.

`orgId`/`custodianOrgId` are only meaningful during plan introspection, where we inspect instructions across multiple orgs to decide which ones are ours. That context belongs in the plan-level type (`LegAccount`), not in the service-level types.

This gives two layers:

```ts
// Service-level (routes -> adapter): minimal, no org context
type Source = { finId: string };
type Destination = { finId?: string; account?: LedgerAccount };

// Plan introspection (execution plan mapper): full org context
type LegAccount = { finId: string; orgId: string; custodianOrgId: string; asset: Asset };
```

### Skeleton-level action

Apply the simple model at the skeleton level:

1. `Source = { finId: string }` — always managed, no ledger account (adapter resolves internally)
2. `Destination = { finId?: string; account?: LedgerAccount }` — optional finId (may not be known for external counterparties), optional wallet address from the router
3. Keep `LegAccount` with `orgId`/`custodianOrgId` for plan introspection only
4. Leave `ManagedAccountRef` / `ExternalAccountRef` / `AccountRef` for adapters to implement locally if they want

This matches the recommendation in this document: normalize at the adapter boundary first, promote into shared skeleton types only after a few adapters confirm the model.

## References

- `skeleton/src/models/model.ts`
- `skeleton/src/routes/mapping.ts`
- `skeleton/src/routes/operational.ts`
- `skeleton/src/services/mapping.ts`
- `skeleton/src/storage/accounts.ts`
- `skeleton/src/routes/mapping-api-gen.ts`
- `sample-adapter/src/services/inmemory/tokens.ts`

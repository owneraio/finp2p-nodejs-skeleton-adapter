# Task: Extract Common Asset And Mapping Storage From `workflows`

## Summary

Follow up the explicit-storage cleanup by moving asset storage and account-mapping storage out of `src/workflows/`.

This is a broader architectural step than the current PR:

- workflow operation persistence remains workflow-specific
- asset storage and account-mapping storage become shared package capabilities

The key principle is simple:

`assets` and `account mappings` must not be modeled as workflow-only logic.

## Why This Should Happen

After the current refactor, `Storage` no longer relies on global connection discovery, which is good. But the module boundary is still wrong:

- `skeleton/src/workflows/storage.ts` still contains:
  - workflow operation persistence
  - asset storage
  - account-mapping storage
- `skeleton/src/services/mapping.ts` still imports `Storage` from `../workflows/storage`
- consumers still discover common storage through the `workflows` namespace

That keeps a misleading mental model in place even after the global-state issue is fixed.

## External Consumer Reality

This is not just an internal cleanup in the skeleton. The Ethereum adapter already uses mapping as common infrastructure.

### Observed usage in `owneraio/finp2p-ethereum-adapter`

- [`src/services/direct/account-mapping.ts`](https://github.com/owneraio/finp2p-ethereum-adapter/blob/master/src/services/direct/account-mapping.ts)
  - `DbAccountMapping` implements both adapter-local account resolution and skeleton `MappingService`
  - it currently calls:
    - `workflows.getAccountMappings(...)`
    - `workflows.getAccountMappingsByFieldValue(...)`
    - `workflows.saveAccountMapping(...)`
    - `workflows.deleteAccountMapping(...)`
- [`src/app.ts`](https://github.com/owneraio/finp2p-ethereum-adapter/blob/master/src/app.ts)
  - DTCC wallet resolution calls `workflows.getAccountMappings([finId])`
  - this is not workflow orchestration; it is shared account lookup
- [`tests/account-mapping.test.ts`](https://github.com/owneraio/finp2p-ethereum-adapter/blob/master/tests/account-mapping.test.ts)
  - currently initializes `workflows.Storage` and then tests DB-backed mapping behavior against it

That usage confirms the original concern: mapping is being used as common storage logic, not as workflow-only behavior.

## Goal

Move shared storage behind a shared namespace and API, while keeping the workflow runtime stable.

## Non-Goals

- Do not redesign crash recovery in this task.
- Do not change the route HTTP surface.
- Do not combine this with a large config-system rewrite.
- Do not move every PostgreSQL concern out of `workflows` in one shot.

## Proposed Boundary

Use a narrow shared module such as `src/storage/`, not a broad catch-all.

Recommended target shape:

- `src/storage/config.ts`
  - shared `StorageConfig`
- `src/storage/postgres.ts`
  - pool/context creation helpers shared by storage implementations
- `src/storage/assets.ts`
  - `AssetStore` interface
  - PostgreSQL implementation for asset reads/writes
- `src/storage/account-mappings.ts`
  - `AccountMappingStore` interface
  - PostgreSQL implementation for mapping reads/writes
- `src/storage/index.ts`
  - public shared exports

Keep `src/workflows/` focused on:

- workflow config
- migration runner
- operation persistence
- `createServiceProxy()`
- crash recovery

## Design Guidance

### 1. Split by capability, not by database

The important extraction is not “everything using Postgres.”

It is:

- shared capability storage:
  - assets
  - account mappings
- workflow-only storage:
  - operations

That gives us a clean architectural line without forcing an all-at-once persistence redesign.

### 2. Use small interfaces for shared consumers

The Ethereum adapter does not really want “workflow storage”.
It wants:

- account lookup by `finId`
- reverse lookup by mapped field value
- CRUD for owner mappings

So the shared API should expose capability-level interfaces such as:

```ts
interface AccountMappingStore {
  getOwnerMappings(finIds?: string[]): Promise<OwnerMapping[]>;
  getByFieldValue(fieldName: string, value: string): Promise<OwnerMapping[]>;
  saveOwnerMapping(finId: string, fields: Record<string, string>): Promise<OwnerMapping>;
  deleteOwnerMapping(finId: string, fieldName?: string): Promise<void>;
}
```

and:

```ts
interface AssetStore {
  getAsset(asset: { id: string; type: string }): Promise<Asset | undefined>;
  saveAsset(asset: Omit<Asset, 'created_at' | 'updated_at'>): Promise<Asset>;
}
```

`MappingServiceImpl` should depend on `AccountMappingStore`, not on workflow storage.

### 3. Keep workflow runtime stable

Do not make `createServiceProxy()` depend on the new shared storage layer more than necessary.

Preferred direction:

- workflow operation persistence stays in `workflows`
- shared stores can use the same underlying `Pool` or DB context, but are separate implementations

### 4. Treat route wiring as a separate concern

There are two distinct questions:

1. Where does the storage logic live?
2. How does `register()` obtain a default implementation?

This task is primarily about question 1.

For question 2, keep scope controlled:

- if built-in mapping still requires workflow-backed config for now, that is acceptable in the first extraction step
- if we later want mapping-only PostgreSQL wiring without workflow proxying, that should be a separate API decision

## Ethereum Adapter Migration Plan

This follow-up must include first-party consumer migration.

### Update `DbAccountMapping`

In the Ethereum adapter:

- stop depending on `workflows.*AccountMapping*` helpers
- depend on the shared account-mapping store API instead

### Update wallet-resolution code

In the DTCC plugin path:

- stop calling `workflows.getAccountMappings([finId])`
- inject a shared mapping lookup dependency

This is important because that code is consuming common account identity data, not workflow state.

### Update tests

Ethereum adapter tests should:

- instantiate the shared PostgreSQL account-mapping implementation directly, or
- instantiate a small shared DB context and pass it into the mapping store

They should not need `workflows.Storage` just to test account mappings.

## Suggested Rollout

### Phase 1

Inside skeleton:

1. Introduce `src/storage/` with shared asset and account-mapping stores.
2. Move `StorageConfig` there, or alias it there first.
3. Refactor `MappingServiceImpl` to depend on `AccountMappingStore`.
4. Keep workflow operation storage in `src/workflows/`.

### Phase 2

First-party consumer migration:

1. Update Ethereum adapter imports and implementations.
2. Update skeleton internal consumers and tests.
3. Add top-level exports for the shared storage API.

### Phase 3

Compatibility cleanup:

1. Remove asset/account-mapping ownership from `workflows`.
2. Optionally keep short-lived aliases only if release coordination requires them.

## Acceptance Criteria

- Asset storage is no longer implemented under `src/workflows/`.
- Account-mapping storage is no longer implemented under `src/workflows/`.
- `MappingServiceImpl` depends on a shared account-mapping store, not workflow storage.
- Workflow operation persistence remains in `src/workflows/`.
- Ethereum adapter no longer imports mapping CRUD via `workflows.*`.
- Ethereum adapter wallet resolution no longer depends on `workflows.getAccountMappings(...)`.
- Tests for shared mapping behavior do not require workflow storage initialization.

## Risks

- Breaking first-party consumers if the new shared API is introduced without updating them together.
- Accidentally dragging workflow-operation concerns into the new shared module.
- Turning `src/storage/` into another dumping ground if the boundary is not kept narrow.

## References

- `skeleton/src/workflows/storage.ts`
- `skeleton/src/services/mapping.ts`
- `https://github.com/owneraio/finp2p-ethereum-adapter/blob/master/src/app.ts`
- `https://github.com/owneraio/finp2p-ethereum-adapter/blob/master/src/services/direct/account-mapping.ts`
- `https://github.com/owneraio/finp2p-ethereum-adapter/blob/master/tests/account-mapping.test.ts`

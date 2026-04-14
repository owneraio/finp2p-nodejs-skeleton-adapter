# Task: Make Shared Storage Explicit In `workflows`

## Summary

Fix the real architectural problem in `src/workflows/storage.ts` without introducing a new top-level module boundary.

The issue is not mainly that the folder is called `workflows`. The issue is that shared persistence for account mappings and assets currently depends on implicit global state:

- `storage.ts` mixes workflow operation storage with asset and account-mapping storage
- free functions use `getFirstConnectionOrDie()`
- `MappingServiceImpl` works only if some `Storage` instance was constructed elsewhere
- `routes.register()` hides that dependency

This task should remove the implicit global behavior and make storage dependencies explicit, while keeping the current package structure.

## Why We Are Doing This

### Current problems

- `skeleton/src/workflows/storage.ts` owns both workflow operation persistence and generic helpers like account mappings and assets.
- `skeleton/src/services/mapping.ts` imports free functions from `../workflows/storage` instead of depending on a storage instance.
- `skeleton/src/routes/routes.ts` instantiates `new MappingServiceImpl()` with no storage dependency even though the implementation silently requires a DB connection to exist.
- `sample-adapter/src/services/inmemory/storage.ts` calls `workflows.saveAccountMapping(...)`, which only works because of global connection discovery.

### What hurts today

- Hidden coupling: mapping support looks independent, but actually depends on side effects from workflow storage bootstrap.
- Brittle tests: mapping/asset tests require global storage initialization.
- Poor API clarity: the user cannot tell which APIs require constructed storage and which do not.

## Goal

Keep the refactor small and local:

1. remove `getFirstConnectionOrDie()`
2. stop exposing account-mapping and asset persistence as global free functions
3. make `MappingServiceImpl` depend on an explicit `Storage`
4. wire that dependency explicitly in `routes.register()`
5. fail fast when mapping is configured without workflow-backed storage
6. leave workflow crash recovery behavior unchanged

## Non-Goals

- Do not create `src/persistence/` in this change.
- Do not introduce compatibility shims or multi-release deprecation paths.
- Do not reorganize tests just to match folder names.
- Do not move `migrator.ts` unless required by the implementation.
- Do not change external HTTP APIs.
- Do not redesign workflow crash recovery or replace the `Storage` class abstraction.

## Proposed Approach

### 1. Keep `Storage` as the single PostgreSQL entry point

`skeleton/src/workflows/storage.ts` should continue to own the PostgreSQL-backed storage object for now.

But:

- account-mapping helpers become instance methods on `Storage`
- asset helpers become instance methods on `Storage`
- operation helpers used by workflow proxy remain instance methods on `Storage`
- free functions relying on global connection lookup are removed

This keeps the change scoped to one existing abstraction instead of creating a new module hierarchy.

### 2. Make `MappingServiceImpl` take storage explicitly

Refactor `skeleton/src/services/mapping.ts` to:

- accept `storage: Storage` in the constructor
- delegate to storage instance methods instead of free functions

Expected shape:

```ts
const mappingService = new MappingServiceImpl(storage);
```

This makes the dependency visible and trivial to test.

### 3. Wire mapping and workflow through the same `Storage` instance

In `skeleton/src/routes/routes.ts`:

- fail immediately at the top of `register()` if `mappingConfig` is provided without `workflowConfig`
- create one `Storage` when `workflowConfig` is provided
- pass it to workflow proxy setup
- pass it to the default `MappingServiceImpl`

The throw should happen before any routes are registered so misconfiguration is detected at app startup, not on first request.

Recommended error direction:

```ts
throw new Error('mappingConfig requires workflowConfig because built-in mapping storage uses PostgreSQL-backed workflows Storage');
```

The exact message can differ, but the failure should be immediate and explicit.

### 4. Update internal consumers

- `sample-adapter` should stop calling `workflows.saveAccountMapping(...)`
- preferred direction: pass an explicit callback or `Storage`-backed writer into the in-memory storage layer instead of importing workflow free functions there
- if that wiring adds too much surface area for the sample, remove the fire-and-forget mapping write instead of reintroducing hidden global coupling
- tests should instantiate `Storage` explicitly and call instance methods

## Why This Approach

This solves the problems we can clearly see in the current code:

- removes implicit global state
- makes dependencies explicit
- improves testability
- avoids speculative boundary design
- avoids introducing a new configuration matrix

It does **not** try to solve the naming problem completely. That can be revisited later if the codebase grows enough to justify a separate persistence boundary.

## Crash Recovery

Crash recovery should remain exactly where it is today:

- keep the `Storage` class
- keep operation persistence methods on `Storage`
- keep `createServiceProxy()` behavior unchanged

This task is about making asset and mapping persistence explicit, not reworking workflow replay semantics.

## Suggested Implementation Steps

1. Remove `getFirstConnectionOrDie()` and the global connection registry usage for account-mapping and asset access.
2. Convert free functions in `skeleton/src/workflows/storage.ts` into `Storage` instance methods.
3. Refactor `MappingServiceImpl` to require `Storage` in its constructor.
4. Update `routes.register()` to pass `Storage` explicitly into both workflow proxying and default mapping service creation.
5. Add a clear startup failure at the beginning of `routes.register()` when `mappingConfig` is set without `workflowConfig`.
6. Update `sample-adapter` to use explicit storage wiring, or remove the current fire-and-forget mapping write if explicit wiring is not worth the extra coupling.
7. Update tests to exercise storage via instance methods.
8. Update docs to describe the explicit dependency.

## Acceptance Criteria

- `getFirstConnectionOrDie()` is removed.
- Account-mapping and asset persistence no longer depend on globally discovered connections.
- `MappingServiceImpl` requires `Storage` explicitly.
- `routes.register()` constructs one `Storage` instance and reuses it for both workflow proxying and built-in mapping support.
- Enabling `mappingConfig` without `workflowConfig` fails fast with a clear error before any routes are registered.
- `sample-adapter` no longer calls global `workflows.saveAccountMapping(...)`.
- Existing workflow proxy and crash-recovery behavior continues to work unchanged.
- Tests cover:
  - mapping persistence via explicit `Storage`
  - asset persistence via explicit `Storage`
  - failure when `mappingConfig` is provided without `workflowConfig`

## Risks

- Breaking current call sites that use free functions from `workflows`.
- Accidentally changing crash-recovery behavior while editing `Storage`.
- Leaving partial global-state helpers behind and ending up with two supported patterns.

## Out Of Scope For This Task

- Renaming `workflows` to `persistence`
- compatibility re-exports
- test directory renames
- deeper migration/config ownership cleanup

Those can be reconsidered later if we see repeated pain after the global-state cleanup lands.

## References

- `skeleton/src/workflows/storage.ts`
- `skeleton/src/services/mapping.ts`
- `skeleton/src/routes/routes.ts`
- `sample-adapter/src/services/inmemory/storage.ts`

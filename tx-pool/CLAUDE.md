# tx-pool

> `@owneraio/finp2p-tx-pool` &mdash; EVM transaction pool for FinP2P adapters. Optional: nothing else in the monorepo references it; adapters opt in via `createTxPool`.

## Purpose

Drop-in wrappers for ethers v6 `Provider`/`Signer` that solve the four problems every EVM adapter re-solves:

1. **Nonce management** &mdash; nonces are allocated through a PostgreSQL counter row, safe under concurrent sends and across replicas.
2. **Nonce-conflict retry** &mdash; a broadcast failing with "nonce too low"/"already used" resyncs the counter from the chain and retries on a fresh nonce.
3. **Stuck-tx resend** &mdash; a tx pending longer than `stuckTimeoutMs` is replaced (same nonce, same payload, fees bumped `feeBumpPercent`); after `maxResends` bumps the nonce is burned with a 0-value self-transfer (cancel).
4. **Persistence** &mdash; every tx is written to PostgreSQL *before* broadcast; a crashed process's work is recovered and finished by any replica.

## Usage

```ts
import { Pool } from 'pg';
import { JsonRpcProvider, Wallet, Contract } from 'ethers';
import { createTxPool } from '@owneraio/finp2p-tx-pool';

const txPool = createTxPool({
  provider: new JsonRpcProvider(rpcUrl),
  signer: new Wallet(privateKey),
  pool: new Pool({ connectionString }),   // caller owns the pool lifecycle
  config: { stuckTimeoutMs: 30_000 },
});
await txPool.start();                      // first tick = crash recovery

const contract = new Contract(address, abi, txPool.signer);
const tx = await contract.transfer(to, amount);          // nonce managed, persisted, auto-resent
await txPool.provider.waitForTransaction(tx.hash);       // resolves even if fee-bumped

await txPool.stop();                       // does NOT end the pg Pool
```

Migrations: the package exports `migrationsDir` and `migrationsTableName` for the skeleton's migrator:

```ts
import { migrationsDir, migrationsTableName } from '@owneraio/finp2p-tx-pool';
await workflows.migrateIfNeeded({ ...config, additionalMigrations: [{ migrationsDir, tableName: migrationsTableName }] });
```

## Architecture

| File | Contents |
|------|----------|
| `src/index.ts` | `createTxPool` factory, public exports, migration metadata |
| `src/signer.ts` | `TxPoolSigner extends AbstractSigner` &mdash; overrides `sendTransaction`; delegates signing to the wrapped signer. Broadcasts go through `inner.sendTransaction` so both `Wallet` and `JsonRpcSigner` (node-managed keys) work |
| `src/monitor.ts` | `TxMonitor` &mdash; recursive-setTimeout loop; each tick claims rows, polls receipts, bumps/cancels stuck txs, rebroadcasts never-broadcast rows |
| `src/provider.ts` | `wrapProvider` &mdash; Proxy over the raw provider; `getTransactionReceipt`/`getTransaction`/`waitForTransaction` translate any recorded attempt hash to whichever attempt mined |
| `src/store/` | `TxPoolStore` interface, `PgTxPoolStore` (production), `InMemoryTxPoolStore` (single-process dev/tests) |
| `src/fees.ts` | Replacement fee math (EIP-1559 + legacy), `>= pct` above previous attempt AND `>=` current network estimate |
| `src/errors.ts` | Broadcast error classification: ethers codes (`NONCE_EXPIRED`, `REPLACEMENT_UNDERPRICED`) + node-message sniffing fallback |
| `migrations/` | goose migration creating `tx_pool_nonces` + `tx_pool_transactions` in `${LEDGER_SCHEMA:-ledger_adapter}` |

## State machine

```
pending ──broadcast ok──> submitted ──receipt(status=1)+confirmations──> confirmed
   │                          │───────receipt(status=0)────────────────> failed
   │                          │───nonce consumed externally, no receipt─> dropped
   │                          │───stuck > stuckTimeoutMs────────────────┐
   │                          │<──resend same tx, fees bumped───────────┘ (≤ maxResends)
   │                          └───cap reached──> cancelling ──cancel receipt──> cancelled
   │                                                │ (original mines during race → confirmed/failed)
   └──fatal broadcast error──> failed (counter resynced so the freed nonce is reused)
```

Rows stuck in `pending` (crash between insert and broadcast) are rebroadcast by the monitor after `stuckTimeoutMs` &mdash; they block every higher nonce until resolved. Once past the resend cap, cancel attempts keep bumping without a cap until *something* mines.

## Multi-replica model

N processes may share one signer key and one database:

- **Nonce allocation**: `tx_pool_nonces` counter row locked `FOR UPDATE` in the same transaction as the tx-row insert. A partial unique index (`signer, chain, nonce WHERE status IN pending/submitted/cancelling`) enforces one live tx per nonce; terminal rows keep history without blocking reuse.
- **Monitor work**: each tick claims a batch via `FOR UPDATE SKIP LOCKED` + a `claimed_until` lease (`claimLeaseMs`). RPC work happens outside the DB transaction; a dead replica's claims expire and are picked up by others.
- `InMemoryTxPoolStore` mirrors the same semantics but is single-process only.

## Config (all optional)

| Key | Default | Meaning |
|-----|---------|---------|
| `stuckTimeoutMs` | 30 000 | pending longer than this &rarr; fee-bump resend |
| `checkIntervalMs` | 5 000 | monitor tick cadence |
| `claimLeaseMs` | 60 000 | monitor claim lease |
| `claimBatchSize` | 50 | rows claimed per tick per replica |
| `maxResends` | 5 | fee bumps before cancelling |
| `maxNonceRetries` | 3 | nonce-conflict retries at send time |
| `feeBumpPercent` | 13 | bump on both EIP-1559 fields (geth needs &ge;10) or `gasPrice` |
| `confirmations` | 1 | blocks on top of inclusion before terminal |
| `schemaName` | `ledger_adapter` | PostgreSQL schema |

## Caveats

- `sendTransaction` resolves after broadcast with a normal `TransactionResponse`. If the monitor later replaces the tx, `tx.wait()` on the original response may throw `TRANSACTION_REPLACED` depending on ethers' replacement classification &mdash; `txPool.provider.waitForTransaction(anyAttemptHash)` always resolves via the store and is the reliable path.
- An explicit `nonce` in the request is honored verbatim and never retried on conflict.
- A `dropped` row means the nonce was consumed by a tx the pool didn't send (or whose hash it lost); the payload was **not** executed.
- Broadcasts within one replica serialize on an in-process mutex (allocation &rarr; insert &rarr; broadcast); throughput is one broadcast at a time per replica by design.

## Build & test

```bash
npm install ../skeleton && npm install   # restore the version range in package.json before committing
npm run build
npm test                                 # Docker (postgres + foundry/anvil testcontainers) + goose on PATH
```

Tests run against a real anvil node with automining paused (`anvil --no-mining`), driving the full state machine: replacement eviction, cancel-after-cap, reverts, externally consumed nonces, crash recovery, and two live replicas sharing one database (`tests/multi-replica.test.ts`).

## See also

- [Top-level CLAUDE.md](../CLAUDE.md) &mdash; monorepo overview
- [vanilla-service](../vanilla-service/) &mdash; the sibling-package template this package follows

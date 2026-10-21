# @owneraio/log-interface

Logging contract for FinP2P adapters: 4 levels, structured meta, child loggers, redaction

## Why

winston's `Logger` type declares both `warn()` and `warning()`; only one exists at runtime (npm levels → `warn`, syslog → `warning`). Wrong one = `TypeError` or silently dropped entry. Upstream closed without fix (winstonjs/winston#2280). `fromWinston` resolves the name once from `w.levels`.

## Contract

```ts
type Level = 'debug' | 'info' | 'warn' | 'error';
type Meta  = Readonly<Record<string, unknown>>;
type LogFn = (message: string, meta?: Meta) => void;

interface Log {
  readonly [LOG]: true;   // type-only brand: only factories below can mint a Log
  readonly debug: LogFn; readonly info: LogFn; readonly warn: LogFn; readonly error: LogFn;
  child(meta: Meta): Log; // meta attached to every entry; entry meta wins
}
```

| rule | consequence |
|------|-------------|
| first arg is `string` | `log.error('x', err)` → `log.error('x', { error: err })` |
| `Meta` is an index signature | interface-typed value → spread: `{ ...cfg }` |
| `Error` in meta | normalized to `{ name, message, stack }` by every factory |
| `isLevel(x)` | type guard for `process.env.LOG_LEVEL` |

## Factories

| factory | import | notes |
|---------|--------|-------|
| `fromWinston(w)` | `@owneraio/log-interface/winston` | optional peer dep; picks `warn`/`warning` from `w.levels`; throws `UnsupportedWinstonLevelsError`; always `w.log()` |
| `fromConsole({ level, format, target })` | root | `level` default `info`; `format: 'pretty' \| 'json'` |
| `fromSink((level, message, meta) => ..)` | root | any backend: pino, spies |
| `silentLog()` | root | no-op |

## Redaction

```ts
const log = withRedaction(fromWinston(w), { secrets: secretsFromEnv() });
log.error('RPC_URL=https://user:pw@host/ failed', { config });
// "RPC_URL=https://[redacted]@host/ failed", config.privateKey → "[redacted]"
```

| default rule | example → result |
|--------------|------------------|
| URL userinfo | `https://u:p@host/` → `https://[redacted]@host/` |
| HTTP auth | `Bearer eyJ…` → `Bearer [redacted]` |
| PEM private key block | → `[redacted]` |
| `k=v`, `k: v`, `"k":"v"` in text, `k` secret | `DB_PASSWORD=x` → `DB_PASSWORD=[redacted]` |
| secret key in meta, any depth | `{ cfg: { API_KEY } }` → `[redacted]` |
| `options.secrets` literals | `secretsFromEnv()` = env vars named like secrets, longest first, JSON-escaped forms too |

Secret key = lowercase, strip `_`/`-`, then exact (`password`, `secret`, `apiKey`, `privateKey`, `mnemonic`, `authorization`, `accessToken`, `connectionString`, …) or suffix (`*password`, `*secret`, `*privateKey`, `*apiKey`, `*authToken`, …). Bare `token` excluded (`tokenId`, `tokenAddress`); add via `keys: ['token']`.
Not redacted: bare `0x`+64 hex (looks like a tx hash); pass via `secrets`.

Options: `secrets: string[]`, `keys: string[]`, `patterns: RegExp[]` (global).

## Files

```
src/log.ts      Level, Meta, LogFn, Log, Sink, isLevel, normalizeMeta, fromSink, silentLog
src/console.ts  fromConsole
src/redact.ts   withRedaction, redactText, redactMeta, secretsFromEnv, isSecretKey, REDACTED
src/winston.ts  fromWinston, UnsupportedWinstonLevelsError   (subpath only; root never loads winston)
src/index.ts    log + console + redact
```

## Commands

```bash
npm ci && npm run build && npm test     # build = eslint --fix + tsc -p tsconfig.build.json
npm version X.Y.Z --no-git-tag-version  # CI checks package.json == package-lock.json
git tag log-interface-vX.Y.Z            # → publish-log-interface.yml → GitHub Packages
```

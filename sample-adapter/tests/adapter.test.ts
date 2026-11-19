import {runAdapterTests} from "@owneraio/adapter-tests"

runAdapterTests({
  mapping: true,
  swap: true,
  capabilities: true,
  ledger: { network: 'inmemory', standard: 'mock' },
});

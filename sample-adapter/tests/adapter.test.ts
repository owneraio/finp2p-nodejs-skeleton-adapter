import {runAdapterTests} from "@owneraio/adapter-tests"

runAdapterTests({
  mapping: true,
  swap: true,
  ledger: { network: 'inmemory', standard: 'mock' },
});

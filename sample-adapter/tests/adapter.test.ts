import {runAdapterTests} from "@owneraio/adapter-tests"

runAdapterTests({
  mapping: true,
  ledger: { network: 'inmemory', standard: 'mock' },
});

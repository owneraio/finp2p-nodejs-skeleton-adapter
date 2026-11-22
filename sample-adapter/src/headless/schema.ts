// Config pages of the sample adapter (adapter-config/2). Data only: the
// skeleton renders, validates and stores them; handler.ts gives them meaning.
// Every page is kind 'network': one config per ledger, the config id is the
// ledger (CAIP-2 like eip155:31337, or `inmemory` for the demo ledger).
import { config } from '@owneraio/finp2p-nodejs-skeleton-adapter';

export const pages: config.ConfigPage[] = [
  {
    id: 'ledger',
    title: 'Ledger',
    description: 'How the adapter reaches this ledger. The config id is the ledger (CAIP-2) assets name in their binding.',
    fields: [
      {
        name: 'LEDGER_KIND',
        label: 'Ledger kind',
        type: 'enum',
        required: true,
        default: 'inmemory',
        options: [
          { value: 'inmemory', label: 'In-memory', help: 'Balances kept in process. For demos and tests.' },
          { value: 'evm', label: 'EVM', help: 'Any JSON-RPC chain (anvil, sepolia, polygon ...).' },
        ],
      },
      { name: 'LABEL', label: 'Label', type: 'string', help: 'Free text shown in logs.' },
    ],
  },
  {
    id: 'evm',
    title: 'EVM connection',
    visibleWhen: { field: 'LEDGER_KIND', equals: 'evm' },
    fields: [
      { name: 'RPC_URL', label: 'RPC URL', type: 'url', required: true, placeholder: 'http://127.0.0.1:8545' },
      { name: 'CHAIN_ID', label: 'Chain id', type: 'number', required: true, min: 1, help: 'Checked against eth_chainId of the RPC and against the eip155 ledger id.' },
      { name: 'OPERATOR_PRIVATE_KEY', label: 'Operator private key', type: 'hex', secret: true, required: true },
      { name: 'RPC_AUTH', label: 'RPC basic auth', type: 'string', secret: true, placeholder: 'user:pass' },
    ],
  },
];

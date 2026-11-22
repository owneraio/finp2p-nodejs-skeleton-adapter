// ConfigHandler of the sample adapter: turns an applied network config into a
// LedgerConnection keyed by ledger (CAIP-2) that the services read from.
// Secrets (the operator wallet) stay in a separate map that is never handed out.
import { Wallet } from 'ethers';
import { config, logger } from '@owneraio/finp2p-nodejs-skeleton-adapter';

export type LedgerKind = 'inmemory' | 'evm';

export interface LedgerConnection {
  /** The ledger this connection serves; equals the config id. */
  network: string;
  kind: LedgerKind;
  chainId?: number;
  rpcUrl?: string;
  operatorAddress?: string;
}

const RPC_TIMEOUT_MS = 5_000;
const EIP155 = /^eip155:(\d+)$/;

const basicAuth = (auth: string | undefined): Record<string, string> =>
  (auth ? { authorization: `Basic ${Buffer.from(auth, 'utf8').toString('base64')}` } : {});

/** eth_chainId over plain fetch: ethers' provider retries forever on a bad URL, this fails fast. */
export async function fetchChainId(rpcUrl: string, auth?: string): Promise<number> {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...basicAuth(auth) },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
    signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`rpc answered ${res.status}`);
  const body = await res.json() as { result?: unknown; error?: { message?: string } };
  if (body.error) throw new Error(`rpc error: ${body.error.message ?? 'unknown'}`);
  if (typeof body.result !== 'string') throw new Error('rpc returned no chain id');
  const chainId = Number.parseInt(body.result, 16);
  if (!Number.isFinite(chainId)) throw new Error(`rpc returned a bad chain id: ${body.result}`);
  return chainId;
}

const walletOf = (privateKey: string): Wallet => {
  try {
    return new Wallet(privateKey);
  } catch {
    // ethers' message may echo the input; never let the key out
    throw new Error('OPERATOR_PRIVATE_KEY is not a valid secp256k1 private key');
  }
};

/** Something that knows which ledgers still have assets (the in-memory storage here). */
export interface AssetsByNetwork {
  assetsOnNetwork(network: string): string[];
}

export class SampleConfigHandler implements config.ConfigHandler {
  /** ledger (CAIP-2) -> connection */
  readonly connections = new Map<string, LedgerConnection>();

  private readonly signers = new Map<string, Wallet>();

  constructor(private readonly assets?: AssetsByNetwork) {}

  async check(ref: config.ConfigRef, values: config.ConfigValues, secrets: config.ConfigValues): Promise<config.ConfigCheck[]> {
    if (values.LEDGER_KIND !== 'evm') return [];
    const checks: config.ConfigCheck[] = [];
    const expected = Number(values.CHAIN_ID);
    // the ledger id is the config id: an eip155 id must name the same chain as CHAIN_ID
    const m = ref.id ? EIP155.exec(ref.id) : null;
    if (ref.id && !m) {
      checks.push({ id: 'ledger-id', label: 'Ledger id', ok: false, message: `an EVM ledger is named eip155:<chainId>, got ${ref.id}` });
    } else if (m && Number(m[1]) !== expected) {
      checks.push({ id: 'ledger-id', label: 'Ledger id', ok: false, message: `ledger ${ref.id} does not match CHAIN_ID ${expected}` });
    }
    try {
      const actual = await fetchChainId(values.RPC_URL, secrets.RPC_AUTH);
      checks.push(actual === expected
        ? { id: 'rpc', label: 'RPC', ok: true, message: `chain id ${actual}` }
        : { id: 'rpc', label: 'RPC', ok: false, message: `rpc reports chain id ${actual}, CHAIN_ID says ${expected}` });
    } catch (e) {
      checks.push({ id: 'rpc', label: 'RPC', ok: false, message: e instanceof Error ? e.message : String(e) });
    }
    try {
      const { address } = walletOf(secrets.OPERATOR_PRIVATE_KEY);
      checks.push({ id: 'operator-key', label: 'Operator key', ok: true, message: address });
    } catch (e) {
      checks.push({ id: 'operator-key', label: 'Operator key', ok: false, message: e instanceof Error ? e.message : String(e) });
    }
    return checks;
  }

  async activate(cfg: config.ActiveConfig): Promise<void> {
    const { values, secrets } = cfg;
    const network = cfg.id;
    let connection: LedgerConnection;
    if (values.LEDGER_KIND === 'evm') {
      const wallet = walletOf(secrets.OPERATOR_PRIVATE_KEY);
      this.signers.set(network, wallet);
      connection = {
        network,
        kind: 'evm',
        chainId: Number(values.CHAIN_ID),
        rpcUrl: values.RPC_URL,
        operatorAddress: wallet.address,
      };
    } else {
      this.signers.delete(network);
      connection = { network, kind: 'inmemory' };
    }
    this.connections.set(network, connection);
    // origin only: a url with embedded credentials is rejected by the schema, but never log the full thing anyway
    const rpcUrl = connection.rpcUrl ? new URL(connection.rpcUrl).origin : undefined;
    logger.info('ledger connection ready', { ...connection, rpcUrl, label: values.LABEL });
  }

  async deactivate(ref: config.ConfigRef): Promise<void> {
    this.connections.delete(ref.id);
    this.signers.delete(ref.id);
  }

  /** A ledger with assets on it cannot be removed, only reconfigured. */
  async inUse(ref: config.ConfigRef): Promise<string | false> {
    const assets = this.assets?.assetsOnNetwork(ref.id) ?? [];
    return assets.length > 0 ? `${assets.length} asset(s) on ${ref.id}: ${assets.slice(0, 5).join(', ')}` : false;
  }

  signer(network: string): Wallet | undefined {
    return this.signers.get(network);
  }
}

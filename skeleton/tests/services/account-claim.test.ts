import { NetworkAccountServiceImpl } from '../../src/services/accounts';
import { PluginManager } from '../../src/plugins';
import {
  AccountClaimPlugin,
  AccountClaimResult,
  AccountInvalidShapeError,
  Logger,
  NetworkAccount,
  NetworkAccountValidator,
  PluginLifecycle,
} from '../../src/models';
import { NetworkAccountRow, NetworkAccountStore } from '../../src/storage';

/**
 * In-memory NetworkAccountStore with the one property the service depends on:
 * insert() returns the pre-existing row for a repeat (org, asset, finId)
 * instead of inserting a second one. No PostgreSQL, so these run everywhere.
 */
class FakeStore implements NetworkAccountStore {

  readonly rows = new Map<string, NetworkAccountRow>();

  private key(organizationId: string, assetId: string, finId: string) {
    return `${organizationId}|${assetId}|${finId}`;
  }

  async insert(row: NetworkAccountRow): Promise<NetworkAccountRow> {
    const k = this.key(row.organizationId, row.assetId, row.finId);
    const existing = this.rows.get(k);
    if (existing) return existing;
    this.rows.set(k, row);
    return row;
  }

  async getByFinId(organizationId: string, assetId: string, finId: string) {
    return this.rows.get(this.key(organizationId, assetId, finId));
  }

  async remove(accountId: string) {
    for (const [k, row] of this.rows) {
      if (row.accountId === accountId) {
        this.rows.delete(k);
        return row;
      }
    }
    return undefined;
  }
}

/** Records every call so the tests can assert the claim ran, or did not. */
class RecordingClaimPlugin implements AccountClaimPlugin {

  readonly calls: { organizationId: string, assetId: string, finId: string, account: NetworkAccount }[] = [];

  constructor(private readonly results: AccountClaimResult[]) {
  }

  async claim(organizationId: string, assetId: string, finId: string, account: NetworkAccount): Promise<AccountClaimResult> {
    this.calls.push({ organizationId, assetId, finId, account });
    // Last result repeats, so a test can give one result and call twice.
    return this.results[Math.min(this.calls.length - 1, this.results.length - 1)];
  }
}

const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warning: () => undefined,
  error: () => undefined,
  alert: () => undefined,
};

const ORG = 'bank-x';
const ASSET = 'bank-x:102:asset-1';
const FIN = '02a1b2c3';
const wallet = (address: string): NetworkAccount => ({ type: 'walletAccount', address });
const bind = (address: string) => ({ account: wallet(address) });

const serviceWith = (plugin?: AccountClaimPlugin, validator?: NetworkAccountValidator) => {
  const store = new FakeStore();
  const pluginManager = new PluginManager();
  if (plugin) pluginManager.registerAccountClaimPlugin(plugin);
  return { store, pluginManager, service: new NetworkAccountServiceImpl(store, validator, pluginManager) };
};

describe('account claim plugin', () => {

  it('stores the binding when the claim is linked', async () => {
    const plugin = new RecordingClaimPlugin([{ type: 'linked' }]);
    const { store, service } = serviceWith(plugin);

    const op = await service.createAccount('ik-1', ORG, ASSET, FIN, bind('0xabc'));

    expect(op.type).toBe('success');
    expect(plugin.calls).toHaveLength(1);
    expect(plugin.calls[0]).toEqual({ organizationId: ORG, assetId: ASSET, finId: FIN, account: wallet('0xabc') });
    expect(store.rows.size).toBe(1);
  });

  it('fails with the plugin code and message when the claim is refused, and stores nothing', async () => {
    const plugin = new RecordingClaimPlugin([
      { type: 'refused', code: 7401, message: 'linked-elsewhere: wallet belongs to another participant', reason: 'linked-elsewhere' },
    ]);
    const { store, service } = serviceWith(plugin);

    const op = await service.createAccount('ik-1', ORG, ASSET, FIN, bind('0xabc'));

    expect(op.type).toBe('failure');
    if (op.type !== 'failure') throw new Error('unreachable');
    expect(op.error.code).toBe(7401);
    expect(op.error.message).toContain('linked-elsewhere');
    expect(store.rows.size).toBe(0);
  });

  it('claims again on a repeat create and replays the stored binding', async () => {
    const plugin = new RecordingClaimPlugin([{ type: 'linked' }]);
    const { store, service } = serviceWith(plugin);

    const first = await service.createAccount('ik-1', ORG, ASSET, FIN, bind('0xabc'));
    const second = await service.createAccount('ik-2', ORG, ASSET, FIN, bind('0xabc'));

    // The claim is unconditional: there is no read-before-insert that could
    // tell a repeat apart, which is why the plugin contract demands idempotency.
    expect(plugin.calls).toHaveLength(2);
    expect(first.type).toBe('success');
    expect(second.type).toBe('success');
    if (first.type !== 'success' || second.type !== 'success') throw new Error('unreachable');
    expect(second.record.id).toBe(first.record.id);
    expect(store.rows.size).toBe(1);
  });

  it('never deletes a stored binding when a repeat create is refused', async () => {
    const plugin = new RecordingClaimPlugin([
      { type: 'linked' },
      { type: 'refused', code: 7401, message: 'the link was removed at the authority' },
    ]);
    const { store, service } = serviceWith(plugin);

    const first = await service.createAccount('ik-1', ORG, ASSET, FIN, bind('0xabc'));
    const second = await service.createAccount('ik-2', ORG, ASSET, FIN, bind('0xabc'));

    expect(first.type).toBe('success');
    expect(second.type).toBe('failure');
    // Unbinding is DELETE /accounts/{accountId} and nothing else. A refusal
    // reports a problem; it does not act on the store.
    expect(store.rows.size).toBe(1);
    expect(await store.getByFinId(ORG, ASSET, FIN)).toBeDefined();
  });

  it('behaves exactly as before when no claim plugin is registered', async () => {
    const store = new FakeStore();
    const withEmptyManager = new NetworkAccountServiceImpl(store, undefined, new PluginManager());
    const withNoManager = new NetworkAccountServiceImpl(new FakeStore());

    const a = await withEmptyManager.createAccount('ik-1', ORG, ASSET, FIN, bind('0xabc'));
    const b = await withNoManager.createAccount('ik-1', ORG, ASSET, FIN, bind('0xabc'));

    expect(a.type).toBe('success');
    expect(b.type).toBe('success');
    expect(store.rows.size).toBe(1);
  });

  it('runs the claim after the validator, so a malformed account costs no remote call', async () => {
    const plugin = new RecordingClaimPlugin([{ type: 'linked' }]);
    const rejecting: NetworkAccountValidator = {
      validate: async () => {
        throw new AccountInvalidShapeError('not an address this ledger can service');
      },
    };
    const { store, service } = serviceWith(plugin, rejecting);

    await expect(service.createAccount('ik-1', ORG, ASSET, FIN, bind('nonsense')))
      .rejects.toThrow(AccountInvalidShapeError);
    expect(plugin.calls).toHaveLength(0);
    expect(store.rows.size).toBe(0);
  });

  describe('phase 2 results are declared but not honoured yet', () => {
    const phase2: AccountClaimResult[] = [
      { type: 'pending', expiresInSeconds: 600 },
      { type: 'challenge', challenge: { type: 'signatureTemplate', payload: '0xdeadbeef' }, expiresInSeconds: 600 },
    ];

    it.each(phase2)('fails the operation and stores nothing for $type', async (result) => {
      const { store, service } = serviceWith(new RecordingClaimPlugin([result]));

      const op = await service.createAccount('ik-1', ORG, ASSET, FIN, bind('0xabc'));

      expect(op.type).toBe('failure');
      if (op.type !== 'failure') throw new Error('unreachable');
      expect(op.error.message).toContain(result.type);
      expect(op.error.message).toContain('phase 2');
      // The whole point of a claim is that an unproven account is not recorded.
      expect(store.rows.size).toBe(0);
    });
  });
});

describe('PluginManager.init', () => {

  it('calls init once on every registered plugin that has one', async () => {
    const called: string[] = [];
    const claim: AccountClaimPlugin & PluginLifecycle = {
      claim: async () => ({ type: 'linked' }),
      init: async () => {
        called.push('claim');
      },
    };
    const analyzer = {
      analyzePlan: async () => ({}),
      init: async () => {
        called.push('analyzer');
      },
    };
    const manager = new PluginManager();
    manager.registerAccountClaimPlugin(claim);
    manager.registerPlanAnalyzer(analyzer);

    await manager.init(silentLogger);
    expect(called.sort()).toEqual(['analyzer', 'claim']);
  });

  it('is a no-op for a plugin without init, and for no plugins at all', async () => {
    const manager = new PluginManager();
    await expect(manager.init(silentLogger)).resolves.toBeUndefined();

    manager.registerAccountClaimPlugin({ claim: async () => ({ type: 'linked' }) });
    await expect(manager.init(silentLogger)).resolves.toBeUndefined();
  });

  it('rejects when a plugin init throws, so the adapter can stop startup', async () => {
    const manager = new PluginManager();
    manager.registerAccountClaimPlugin({
      claim: async () => ({ type: 'linked' }),
      init: async () => {
        throw new Error('service account rejected by the identity provider');
      },
    } as AccountClaimPlugin & PluginLifecycle);

    await expect(manager.init(silentLogger)).rejects.toThrow('service account rejected');
  });

  it('stops at the first throw and does not init later plugins', async () => {
    const after: string[] = [];
    const manager = new PluginManager();
    // Registration order drives init order: assetCreation runs before accountClaim.
    manager.registerAssetCreationPlugin({
      validateAssetCreation: async () => undefined,
      init: async () => {
        throw new Error('boom');
      },
    } as any);
    manager.registerAccountClaimPlugin({
      claim: async () => ({ type: 'linked' }),
      init: async () => {
        after.push('accountClaim');
      },
    } as AccountClaimPlugin & PluginLifecycle);

    await expect(manager.init(silentLogger)).rejects.toThrow('boom');
    expect(after).toEqual([]);
  });
});

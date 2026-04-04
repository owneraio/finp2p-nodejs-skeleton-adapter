import { migrateIfNeeded, Storage } from '../../src/workflows';

describe('plan metadata storage', () => {
  let container: { connectionString: string; storageUser: string; cleanup: () => Promise<void> };
  let storage: Storage;

  beforeEach(async () => {
    // @ts-ignore
    container = await global.startPostgresContainer();
    await migrateIfNeeded({
      connectionString: container.connectionString,
      // @ts-ignore
      gooseExecutablePath: await global.whichGoose(),
      migrationListTableName: 'finp2p_nodejs_skeleton_migrations',
      storageUser: container.storageUser,
    });
    storage = new Storage(container);
  });

  afterEach(async () => {
    await storage.closeConnections();
    await container.cleanup();
  });

  test('save and retrieve plan metadata', async () => {
    const metadata = {
      intentType: 'loanIntent',
      contractType: 'loan',
      instructions: {
        1: { operationType: 'hold', organizations: ['org-1'] },
        2: { operationType: 'transfer', organizations: ['org-1', 'org-2'] },
      },
      custom: { repoPhase: 'open' },
    };

    await storage.savePlanMetadata('plan-1', metadata);
    const result = await storage.getPlanMetadata('plan-1');

    expect(result).toEqual(metadata);
  });

  test('returns undefined for unknown planId', async () => {
    const result = await storage.getPlanMetadata('does-not-exist');
    expect(result).toBeUndefined();
  });

  test('upserts on second save', async () => {
    await storage.savePlanMetadata('plan-2', { intentType: 'buyingIntent' });
    await storage.savePlanMetadata('plan-2', { intentType: 'loanIntent', contractType: 'loan' });

    const result = await storage.getPlanMetadata('plan-2');
    expect(result).toEqual({ intentType: 'loanIntent', contractType: 'loan' });
  });

  test('stores per-instruction metadata', async () => {
    const metadata = {
      intentType: 'loanIntent',
      instructions: {
        0: { operationType: 'hold', phase: 'open', leg: 'payment' },
        1: { operationType: 'transfer', phase: 'open', leg: 'asset' },
        2: { operationType: 'release', phase: 'open', leg: 'payment' },
        3: { operationType: 'hold', phase: 'close', leg: 'asset' },
        4: { operationType: 'transfer', phase: 'close', leg: 'payment' },
        5: { operationType: 'release', phase: 'close', leg: 'asset' },
      },
    };

    await storage.savePlanMetadata('repo-plan', metadata);
    const result = await storage.getPlanMetadata('repo-plan');

    expect(result!.instructions[0].phase).toBe('open');
    expect(result!.instructions[3].phase).toBe('close');
    expect(result!.instructions[4].leg).toBe('payment');
  });
});

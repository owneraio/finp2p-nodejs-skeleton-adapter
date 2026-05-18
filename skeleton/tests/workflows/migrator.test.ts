import * as migrator from '../../src/workflows/migrator'

describe('toPostgresIdentifier', () => {
  test('passes through already-valid identifiers', () => {
    expect(migrator.toPostgresIdentifier('ledger_adapter')).toBe('ledger_adapter');
    expect(migrator.toPostgresIdentifier('_underscore')).toBe('_underscore');
  });

  test('replaces disallowed characters with underscores', () => {
    expect(migrator.toPostgresIdentifier('sepolia-mainnet')).toBe('sepolia_mainnet');
    expect(migrator.toPostgresIdentifier('ada.pter id')).toBe('ada_pter_id');
    expect(migrator.toPostgresIdentifier('héllo')).toBe('h_llo');
  });

  test('prefixes underscore when result would start with a digit', () => {
    expect(migrator.toPostgresIdentifier('1adapter')).toBe('_1adapter');
    expect(migrator.toPostgresIdentifier('0')).toBe('_0');
  });

  test('truncates with a stable hash suffix and avoids prefix collisions', () => {
    const a = 'Lorem ipsum dolor sit amet consectetur adipiscing elit sed do alpha';
    const b = 'Lorem ipsum dolor sit amet consectetur adipiscing elit sed do bravo';
    const outA = migrator.toPostgresIdentifier(a);
    const outB = migrator.toPostgresIdentifier(b);

    expect(outA).toHaveLength(50);
    expect(outB).toHaveLength(50);
    expect(outA).toMatch(/^Lorem_ipsum_dolor_sit_amet_consectetur_ad_[0-9a-f]{8}$/);
    expect(outB).toMatch(/^Lorem_ipsum_dolor_sit_amet_consectetur_ad_[0-9a-f]{8}$/);
    expect(outA).not.toBe(outB);
    expect(migrator.toPostgresIdentifier(a)).toBe(outA);
  });

  test('throws on empty input', () => {
    expect(() => migrator.toPostgresIdentifier('')).toThrow();
  });
});

describe('Postgres migrator should work properly', () => {
  test('Migrator runs without error when everything provided', async () => {
    // @ts-ignore
    const container = (await global.startPostgresContainer()) as { connectionString: string, storageUser: string, cleanup: () => Promise<void> }

    console.log('migrating', container.connectionString)
    await expect(
      migrator.migrateIfNeeded({
        connectionString: container.connectionString,
        // @ts-ignore
        gooseExecutablePath: await global.whichGoose(),
        migrationListTableName: "js_migration_tables",
        storageUser: container.storageUser
      })
    ).resolves.toBeUndefined()

    await container.cleanup()
  })
})

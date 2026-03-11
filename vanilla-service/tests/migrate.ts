import { spawn } from 'node:child_process';
import path from 'node:path';

function runGoose(goosePath: string, connectionString: string, tableName: string, migrationsDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(goosePath, [
      '-table', tableName,
      '-dir', migrationsDir,
      'up',
    ], {
      env: {
        GOOSE_DBSTRING: connectionString,
        GOOSE_DRIVER: 'postgres',
      },
    });

    let stderr = '';
    proc.stderr.on('data', (data) => { stderr += data.toString(); });
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Migration failed (${tableName}): ${stderr}`));
      } else {
        resolve();
      }
    });
    proc.on('error', reject);
  });
}

export async function runMigrations(goosePath: string, connectionString: string): Promise<void> {
  // Skeleton migrations first (creates schema + account_mappings)
  const skeletonDir = path.resolve(__dirname, '..', '..', 'skeleton', 'migrations');
  await runGoose(goosePath, connectionString, 'finp2p_nodejs_skeleton_migrations', skeletonDir);

  // Then vanilla-service migrations (accounts + transactions)
  const vanillaDir = path.join(__dirname, '..', 'migrations');
  await runGoose(goosePath, connectionString, 'finp2p_vanilla_service_migrations', vanillaDir);
}

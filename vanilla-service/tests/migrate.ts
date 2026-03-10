import { spawn } from 'node:child_process';
import path from 'node:path';

export async function runMigrations(goosePath: string, connectionString: string): Promise<void> {
  const migrationsDir = path.join(__dirname, '..', 'migrations');
  return new Promise((resolve, reject) => {
    const proc = spawn(goosePath, [
      '-table', 'finp2p_vanilla_service_migrations',
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
        reject(new Error(`Migration failed: ${stderr}`));
      } else {
        resolve();
      }
    });
    proc.on('error', reject);
  });
}

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { URL } from 'node:url';
import { logger } from '../helpers';
import { MigrationConfig } from './config';
import { assertValidPostgresIdentifier, DEFAULT_SCHEMA_NAME } from '../storage/config';

interface ProcessResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

function executeProcess(
  executablePath: string,
  args: string[],
  options: {
    env: NodeJS.ProcessEnv;
  },
): Promise<ProcessResult> {
  // Ensure executable exists
  if (!fs.existsSync(executablePath)) {
    throw new Error(`Executable not found at path: ${executablePath}`);
  }

  let stdout = '';
  let stderr = '';

  return new Promise<ProcessResult>((resolve, reject) => {
    const process = spawn(executablePath, args, {
      shell: false,
      env: options.env,
    });

    process.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    process.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    process.on('close', (code) => {
      resolve({ stdout, stderr, code });
    });

    process.on('error', (error) => {
      reject(
        new AggregateError(
          [error],
          `Running migration resolved an error: ${stderr}`,
        ),
      );
    });
  });
}

async function runGooseMigrations(
  config: Omit<MigrationConfig, 'schemaName'> & { schemaName: string }, // schemaName is not optional here
  tableName: string,
  migrationsDir: string,
): Promise<void> {
  const result = await executeProcess(
    config.gooseExecutablePath,
    ['-table', tableName, '-dir', migrationsDir, 'up'],
    {
      env: {
        GOOSE_DBSTRING: config.connectionString,
        GOOSE_DRIVER: 'postgres',
        LEDGER_ADAPTER_USER: config.storageUser,
        LEDGER_SCHEMA: config.schemaName,
      },
    },
  );
  if (result.code === null || result.code !== 0) {
    logger.debug(JSON.stringify({ ...result, msg: 'migration failed' }));
    throw new Error(`Migration didn't finish successfully (${tableName}): ${result.stderr}`);
  }
  logger.info(`migration ran successfully: ${tableName}`);
}

export async function migrateIfNeeded(config: MigrationConfig): Promise<void> {
  // Validate every identifier the migration will splice into SQL/CLI args
  // before spawning goose, so a bad name fails fast instead of mid-run.
  const schemaName = config.schemaName ?? DEFAULT_SCHEMA_NAME;
  assertValidPostgresIdentifier(schemaName);
  assertValidPostgresIdentifier(config.migrationListTableName);
  for (const additional of config.additionalMigrations ?? []) {
    assertValidPostgresIdentifier(additional.tableName);
  }

  const url = new URL(config.connectionString);
  logger.debug(`running migration tool goose at: ${config.gooseExecutablePath} db at: ${url.protocol}://${url.hostname}:${url.port}`);

  // Run skeleton migrations
  const skeletonDir = path.join(__dirname, '..', '..', 'migrations');
  await runGooseMigrations({ ...config, schemaName }, config.migrationListTableName, skeletonDir);

  // Run additional migration sets (e.g. vanilla-service)
  if (config.additionalMigrations) {
    for (const additional of config.additionalMigrations) {
      await runGooseMigrations({ ...config, schemaName }, additional.tableName, additional.migrationsDir);
    }
  }
}

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import path from 'node:path';
import { MigrationConfig } from './config';

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
export async function migrateIfNeeded(config: MigrationConfig): Promise<void> {
  const defaultGoosePath = '/usr/bin/goose';
  const migrationsDir = path.join(__dirname, '..', 'migrations');
  const result = await executeProcess(
    config.gooseExecutablePath ?? defaultGoosePath,
    ['-table', config.migrationListTableName, '-dir', migrationsDir, 'up'],
    {
      env: {
        GOOSE_DBSTRING: config.connectionString,
        GOOSE_DRIVER: 'postgres',
      },
    },
  );
}

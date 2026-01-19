import type { EnvironmentContext, JestEnvironmentConfig } from '@jest/environment';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import axios from 'axios';
import NodeEnvironment from 'jest-environment-node';
import { exec } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { URL } from 'node:url';
import { RandomPortGenerator } from 'testcontainers';

export interface PostgresContainer {
  connectionString: string;
  storageUser: string;
  cleanup: () => Promise<void>
}

export interface PreparedAppHttpServer<UserData> {
  httpAddress: string;
  userData: UserData;
}

export abstract class SkeletonTestEnvironment<UserData> extends NodeEnvironment {

  public allPostgresContainers: PostgresContainer[];

  public preparedApp: PreparedAppHttpServer<UserData> | undefined;

  constructor(config: JestEnvironmentConfig, _context: EnvironmentContext) {
    super(config, _context);
    this.allPostgresContainers = [];
  }

  public async setup() {
    await super.setup();

    const preparedApp = await this.startAppHttpServer(await this.generateRandomPort());
    this.preparedApp = preparedApp;
    this.global.serverAddress = preparedApp.httpAddress;
  }

  public async teardown() {
    await super.teardown();

    const preparedApp = this.preparedApp;
    if (preparedApp !== undefined) await this.stopAppHttpServer(preparedApp);
    this.preparedApp = undefined;

    for (const c of this.allPostgresContainers) {
      await c.cleanup();
    }
  }

  public async generateRandomPort(): Promise<number> {
    return (new RandomPortGenerator()).generatePort();
  }

  public abstract startAppHttpServer(generatedPort: number): Promise<PreparedAppHttpServer<UserData>>;
  public abstract stopAppHttpServer(preparedApp: PreparedAppHttpServer<UserData>): Promise<void>;

  public async startPostgresContainer(): Promise<PostgresContainer> {
    const startedContainer = await new PostgreSqlContainer('postgres:14.19')
      .start();
    const connectionString = startedContainer.getConnectionUri();
    const storageUser = new URL(connectionString).username;
    const retVal: PostgresContainer = {
      connectionString,
      storageUser,
      cleanup: async () => {
        await startedContainer.stop();
      },
    };

    this.allPostgresContainers.push(retVal);
    return retVal;
  }

  public async getGooseExecutablePath(): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      exec('which goose', (err, stdout, stderr) => {
        if (err) {
          reject(err);
          return;
        }

        const path = stdout.trim();
        if (path.length === 0) {
          reject(new Error('"which goose" returned an empty path'));
          return;
        }

        resolve(path);
      });
    });
  }

  public async healthcheckProbe(httpUrl: string, retryCount: number = 30, sleepMsBetweenRetries: number = 300): Promise<void> {
    for (let i = 0; i < retryCount; i++) {
      try {
        const response = await axios.get(httpUrl, { timeout: 10_000 });
        return;
      } catch (e) {
        //  Don't sleep if this was the last attempt
        if (i < retryCount - 1) {
          await sleep(sleepMsBetweenRetries);
        }
      }
    }

    throw new Error('Healthcheck probe couldn\'t resolve in time');
  }
}

import { EnvironmentContext, JestEnvironmentConfig } from "@jest/environment";
import * as console from "console";
import * as http from "http";
import NodeEnvironment from "jest-environment-node";
import { exec } from 'node:child_process';
import { GenericContainer, RandomPortGenerator, StartedTestContainer, Wait } from "testcontainers";

class CustomTestEnvironment extends NodeEnvironment {

  httpServer: http.Server | undefined;
  postgresContainer: StartedTestContainer | undefined;

  async setup() {
    await this.startPostgresContainer()
    this.global.DB_CONNECTION_STRING = `postgresql://finp2p_nodejs:abc@${this.postgresContainer?.getHost()}:${this.postgresContainer?.getFirstMappedPort()}/finp2p_nodejs_db`
    this.global.GOOSE_PATH = await this.whichGoose()
  }

  async teardown() {
    await this.postgresContainer?.stop()
  }

  private async startPostgresContainer() {
    console.log('Starting postgres container...')
    const exposedPort = await new RandomPortGenerator().generatePort()
    const startedContainer = await new GenericContainer("postgres:14.19-alpine3.21")
      .withEnvironment({
        POSTGRES_USER: 'finp2p_nodejs',
        POSTGRES_PASSWORD: 'abc',
        POSTGRES_DB: 'finp2p_nodejs_db'
      })
      .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections'))
      .withExposedPorts({
        host: exposedPort,
        container: 5432
      })
      .start()
    console.log('Postgres container started successfully')
    this.postgresContainer = startedContainer
  }

  private async whichGoose() {
    return new Promise<string>((resolve, reject) => {
      exec('which goose', (err, stdout, stderr) => {
        if (err) {
          reject(err)
          return
        }

        const path = stdout.trim()
        if (path.length === 0) {
          reject(new Error('which goose returned an empty path'))
          return
        }

        resolve(path)
      })
    })
  }
}

module.exports = CustomTestEnvironment;

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { GenericContainer, Wait } from "testcontainers";
import * as console from "console";
import NodeEnvironment from "jest-environment-node";
import { exec } from 'node:child_process';

class CustomTestEnvironment extends NodeEnvironment {

  async setup() {
    this.global.startPostgresContainer = this.startPostgresContainer
    this.global.startAnvilContainer = this.startAnvilContainer
    this.global.whichGoose = this.whichGoose
  }

  async teardown() { }

  private async startPostgresContainer() {
    const startedContainer = await new PostgreSqlContainer("postgres:14.19")
      .start()
    const connectionString = startedContainer.getConnectionUri()
    console.log('started postgres', connectionString)
    return {
      connectionString,
      cleanup: async () => {
        console.log('cleanup postgres', connectionString)
        await startedContainer.stop()
      }
    }
  }

  private async startAnvilContainer() {
    // The foundry image's entrypoint is `sh -c`, so the command is one string.
    const startedContainer = await new GenericContainer("ghcr.io/foundry-rs/foundry:latest")
      .withCommand(["anvil --host 0.0.0.0 --no-mining"])
      .withExposedPorts(8545)
      .withWaitStrategy(Wait.forLogMessage(/Listening on/))
      .start()
    const rpcUrl = `http://${startedContainer.getHost()}:${startedContainer.getMappedPort(8545)}`
    console.log('started anvil', rpcUrl)
    return {
      rpcUrl,
      cleanup: async () => {
        console.log('cleanup anvil', rpcUrl)
        await startedContainer.stop()
      }
    }
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

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import * as console from "console";
import NodeEnvironment from "jest-environment-node";
import { exec } from 'node:child_process';
import { URL } from 'node:url';
import { RandomPortGenerator } from "testcontainers";

class CustomTestEnvironment extends NodeEnvironment {

  async setup() {
    this.global.startPostgresContainer = this.startPostgresContainer
    this.global.whichGoose = this.whichGoose
  }

  async teardown() { }

  private async startPostgresContainer() {
    const exposedPort = await new RandomPortGenerator().generatePort()
    const startedContainer = await new PostgreSqlContainer("postgres:14.19")
      .start()
    const connectionString = startedContainer.getConnectionUri()
    const storageUser = new URL(connectionString).username
    console.log('started', connectionString)
    return {
      connectionString,
      storageUser,
      cleanup: async () => {
        console.log('cleanup', connectionString)
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

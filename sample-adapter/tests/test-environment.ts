import { EnvironmentContext, JestEnvironmentConfig } from "@jest/environment";
import { PostgreSqlContainer, StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import * as console from "console";
import * as http from "http";
import NodeEnvironment from "jest-environment-node";
import { exec } from 'node:child_process';
import { RandomPortGenerator } from "testcontainers";
import createApp from "../src/app";
import { workflows } from "@owneraio/finp2p-nodejs-skeleton-adapter"
import { callbackServer } from '@owneraio/adapter-tests'
import { FinP2PClient } from "@owneraio/finp2p-client";
type AdapterParameters = {
  url: string,
}

class CustomTestEnvironment extends NodeEnvironment {

  adapter: AdapterParameters | undefined;
  httpServer: http.Server | undefined;
  postgresContainer: StartedPostgreSqlContainer | undefined;
  callbackServer: callbackServer.CallbackServer | undefined;

  constructor(config: JestEnvironmentConfig, context: EnvironmentContext) {
    super(config, context);
    this.adapter = this.global.adapter as AdapterParameters | undefined;
  }

  async setup() {
    if (this.adapter !== undefined && this.adapter.url !== undefined) {
      console.log("Using predefined network configuration...");
      return;
    }

    try {
      this.global.callbackServer = await this.startCallbackServer()
      await this.startPostgresContainer()
      this.global.serverAddress = await this.startApp();
    } catch (err) {
      console.error("Error starting container:", err);
    }
  }

  async teardown() {
    console.debug('Test environment teardown')
    try {
      this.httpServer?.close();
      console.debug('CallbackServer close')
      await this.callbackServer?.close()
      console.debug('Workflows close')
      await workflows.Storage.closeAllConnections()
      console.log("Server stopped successfully.");
    } catch (err) {
      console.error("Error stopping server:", err);
    }

    try {
      await this.postgresContainer?.stop()
    } catch (err) {
      console.error("Error stopping postgres:", err)
    }
  }

  private async startCallbackServer() {
    const port = await new RandomPortGenerator().generatePort()
    this.callbackServer = await callbackServer.create(port)
    return this.callbackServer
  }

  private async startApp() {
    const port = await new RandomPortGenerator().generatePort()
    const connectionString = this.postgresContainer?.getConnectionUri() ?? ""
    const app = createApp("my-org", new FinP2PClient(this.callbackServer?.address ?? "", ""), {
      migration: {
        connectionString,
        migrationListTableName: "finp2p_nodejs_skeleton",
        gooseExecutablePath: await this.whichGoose(),
        storageUser: new URL(connectionString).username
      },
      storage: {
        connectionString
      }
    })
    console.log("App created successfully.");

    this.httpServer = app.listen(port, () => {
      console.log(`Server listening on port ${port}`);
    });

    const readiness = await fetch(`http://localhost:${port}/health/readiness`)
    if (!readiness.ok) {
      throw new Error('Error while starting up the server')
      console.error(await readiness.text())
    }

    return `http://localhost:${port}/api`;
  }

  private async startPostgresContainer() {
    console.log('Starting postgres container...')
    const exposedPort = await new RandomPortGenerator().generatePort()
    const startedContainer = await new PostgreSqlContainer("postgres:14.19").start()
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

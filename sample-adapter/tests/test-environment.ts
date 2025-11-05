import { EnvironmentContext, JestEnvironmentConfig } from "@jest/environment";
import * as console from "console";
import * as http from "http";
import NodeEnvironment from "jest-environment-node";
import { exec } from 'node:child_process';
import { GenericContainer, RandomPortGenerator, StartedTestContainer, Wait } from "testcontainers";
import createApp from "../src/app";

type AdapterParameters = {
  url: string,
}

class CustomTestEnvironment extends NodeEnvironment {

  adapter: AdapterParameters | undefined;
  httpServer: http.Server | undefined;
  postgresContainer: StartedTestContainer | undefined;

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
      await this.startPostgresContainer()
      this.global.serverAddress = await this.startApp();
    } catch (err) {
      console.error("Error starting container:", err);
    }
  }

  async teardown() {
    try {
      this.httpServer?.close();
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

  private async startApp() {
    const port = await new RandomPortGenerator().generatePort()
    const dbConnectionString = `postgresql://finp2p_nodejs:abc@${this.postgresContainer?.getHost()}:${this.postgresContainer?.getFirstMappedPort()}/finp2p`
    const app = createApp("my-org", undefined);
    console.log("App created successfully.");

    this.httpServer = app.listen(port, () => {
      console.log(`Server listening on port ${port}`);
    });

    return `http://localhost:${port}/api`;
  }

  private async startPostgresContainer() {
    console.log('Starting postgres container...')
    const exposedPort = await new RandomPortGenerator().generatePort()
    const startedContainer = await new GenericContainer("postgres:14.19-alpine3.21")
      .withEnvironment({
        POSTGRES_USER: 'finp2p_nodejs',
        POSTGRES_PASSWORD: 'abc',
        POSTGRES_DB: 'finp2p'
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

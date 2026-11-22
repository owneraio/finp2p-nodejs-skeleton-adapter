import { EnvironmentContext, JestEnvironmentConfig } from "@jest/environment";
import { PostgreSqlContainer, StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import * as console from "console";
import * as http from "http";
import NodeEnvironment from "jest-environment-node";
import { exec } from 'node:child_process';
import { RandomPortGenerator } from "testcontainers";
import createApp, { SAMPLE_ADAPTER_SCHEMA } from "../src/app";
import { workflows } from "@owneraio/finp2p-nodejs-skeleton-adapter";
import type { Pool } from "pg";

type AdapterParameters = {
  url: string,
}

class CustomTestEnvironment extends NodeEnvironment {

  adapter: AdapterParameters | undefined;
  httpServer: http.Server | undefined;
  postgresContainer: StartedPostgreSqlContainer | undefined;
  pool: Pool | undefined;

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
      await this.pool?.end();
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
    const connectionString = this.postgresContainer?.getConnectionUri() ?? ""

    // Resolve the adapter's schema name, allowing the operator (or a single
    // test run) to override via LEDGER_SCHEMA. Real adapters do the
    // same thing in their own entry points.
    const schemaName = process.env.LEDGER_SCHEMA || SAMPLE_ADAPTER_SCHEMA;

    // Run migrations before starting the app
    await workflows.migrateIfNeeded({
      connectionString,
      migrationListTableName: "finp2p_nodejs_skeleton",
      gooseExecutablePath: await this.whichGoose(),
      storageUser: new URL(connectionString).username,
      schemaName,
    });

    const { app, pool } = createApp("my-org", undefined, { connectionString, schemaName })
    this.pool = pool;
    console.log("App created successfully.");

    this.httpServer = app.listen(port, () => {
      console.log(`Server listening on port ${port}`);
    });

    const readiness = await fetch(`http://localhost:${port}/health/readiness`)
    if (!readiness.ok) {
      throw new Error('Error while starting up the server')
      console.error(await readiness.text())
    }

    this.global.serverBaseAddress = `http://localhost:${port}`;
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

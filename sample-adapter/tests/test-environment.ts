import { workflows } from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { PreparedAppHttpServer, SkeletonTestEnvironment } from "@owneraio/skeleton-test-environment";
import * as http from "http";
import { setTimeout as wait } from 'node:timers/promises';
import createApp from "../src/app";

class CustomTestEnvironment extends SkeletonTestEnvironment<http.Server> {
  async startAppHttpServer(generatedPort: number): Promise<PreparedAppHttpServer<http.Server<typeof http.IncomingMessage, typeof http.ServerResponse>>> {
    const httpAddress = `http://localhost:${generatedPort}/api`
    const postgresContainer = await this.startPostgresContainer()

    const app = createApp("my-org", undefined, {
      migration: {
        ...postgresContainer,
        gooseExecutablePath: await this.getGooseExecutablePath(),
        migrationListTableName: "sample_adapter_migrations"
      },
      storage: {
        ...postgresContainer
      }
    })

    const userData = app.listen(generatedPort)
    await this.healthcheckProbe(`http://localhost:${generatedPort}/health/readiness`)

    return {
      httpAddress,
      userData
    }
  }

  async stopAppHttpServer(preparedApp: PreparedAppHttpServer<http.Server<typeof http.IncomingMessage, typeof http.ServerResponse>>): Promise<void> {
    preparedApp.userData.close()
    await workflows.Storage.closeAllConnections()
  }
}

module.exports = CustomTestEnvironment;

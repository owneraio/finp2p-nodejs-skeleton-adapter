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

    await this.checkHealthReadiness(generatedPort)

    return {
      httpAddress,
      userData: app.listen(generatedPort)
    }
  }

  async stopAppHttpServer(preparedApp: PreparedAppHttpServer<http.Server<typeof http.IncomingMessage, typeof http.ServerResponse>>): Promise<void> {
    preparedApp.userData.close()
    await workflows.Storage.closeAllConnections()
  }

  private async checkHealthReadiness(generatedPort: number): Promise<void> {
    for (let i = 0; i < 30; i++) {
      try {
        const readiness = await fetch(`http://localhost:${generatedPort}/health/readiness`)
        if (readiness.ok) {
          break
        } else {
          throw new Error('should wait')
        }
      } catch {
        await wait(300)
      }
    }
  }
}

module.exports = CustomTestEnvironment;

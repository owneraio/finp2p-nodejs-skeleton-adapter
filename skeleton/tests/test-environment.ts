import { PreparedAppHttpServer, SkeletonTestEnvironment } from '@owneraio/skeleton-test-environment';

class CustomTestEnvironment extends SkeletonTestEnvironment<{}> {
    async setup() {
      await super.setup()

      this.global.startPostgresContainer = () => this.startPostgresContainer()
      this.global.whichGoose = () => this.getGooseExecutablePath()
    }

    async startAppHttpServer(generatedPort: number): Promise<PreparedAppHttpServer<{}>> {
      return {
        httpAddress: "",
        userData: {}
      }
    }

    async stopAppHttpServer(preparedApp: PreparedAppHttpServer<{}>): Promise<void> {
      // nop
    }
}

module.exports = CustomTestEnvironment;

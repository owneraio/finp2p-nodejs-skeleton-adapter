// Headless boot: core env only. Network configs (one per ledger, CAIP-2) are
// applied later over HTTP (POST /config/apply) and restored from the DB on every start.
//
//   ORGANIZATION_ID        required
//   DB_CONNECTION_STRING   optional; enables workflows + persisted configs (goose migrations run at boot)
//   LEDGER_SCHEMA          postgres schema, default sample_adapter
//   GOOSE_PATH             goose binary, default `which goose`
//   FINP2P_ADDRESS/OSS_URL optional; router callbacks
//   ADAPTER_ID, PORT
//   KMS_KEY_ID (+AWS_ENDPOINT_URL/AWS_REGION) selects the KMS sealer, else a local RSA key (persisted when a DB exists)
//   REQUIRE_SEALED_SECRETS=true rejects plaintext secrets
import * as process from 'process';
import { exec } from 'node:child_process';
import { Pool } from 'pg';
import { ConfigurationError, logger, workflows, config } from '@owneraio/finp2p-nodejs-skeleton-adapter';
import { FinP2PClient } from '@owneraio/finp2p-client';
import createApp, { SAMPLE_ADAPTER_SCHEMA } from './app';

const whichGoose = (): Promise<string> => new Promise((resolve, reject) => {
  if (process.env.GOOSE_PATH) {
    resolve(process.env.GOOSE_PATH);
    return;
  }
  exec('which goose', (err, stdout) => {
    const found = stdout.trim();
    if (err || !found) reject(new ConfigurationError('goose not found: set GOOSE_PATH'));
    else resolve(found);
  });
});

const init = async () => {
  const port = process.env.PORT || '3000';

  const orgId = process.env.ORGANIZATION_ID;
  if (!orgId) {
    throw new ConfigurationError('ORGANIZATION_ID is not set');
  }
  let finP2PClient: FinP2PClient | undefined;
  const finAPIUrl = process.env.FINP2P_ADDRESS;
  const ossUrl = process.env.OSS_URL;
  if (finAPIUrl && ossUrl) {
    finP2PClient = new FinP2PClient(finAPIUrl, ossUrl);
    logger.info('FinP2PClient initialized');
  }

  const schemaName = process.env.LEDGER_SCHEMA || SAMPLE_ADAPTER_SCHEMA;
  const connectionString = process.env.DB_CONNECTION_STRING;
  let pool: Pool | undefined;
  let keyStore: config.KeyStore | undefined;
  if (connectionString) {
    await workflows.migrateIfNeeded({
      connectionString,
      migrationListTableName: 'finp2p_nodejs_skeleton',
      gooseExecutablePath: await whichGoose(),
      storageUser: new URL(connectionString).username,
      schemaName,
    });
    pool = new Pool({ connectionString });
    keyStore = new config.PgConfigStore(pool, schemaName);
  } else {
    logger.warning('DB_CONNECTION_STRING not set: configs and the sealer key live in memory only');
  }
  const sealer = await config.sealerFromEnv(process.env, keyStore);

  const { app, runtime, restored } = createApp(orgId, finP2PClient, {
    pool,
    schemaName,
    sealer,
    requireSealedSecrets: process.env.REQUIRE_SEALED_SECRETS === 'true',
    adapterId: process.env.ADAPTER_ID,
  });
  app.listen(port, () => {
    logger.info(`listening at http://localhost:${port}`);
  });

  // after listen: liveness answers while stored configs come back (readiness waits for them);
  // a missing config is not an error
  await restored;
  const configs = runtime.list();
  const networks = runtime.networks();
  logger.info(`restored ${networks.length}/${configs.length} configs`, {
    configs: configs.map((c) => ({ kind: c.kind, id: c.id, state: c.state, error: c.lastError })),
  });
  if (networks.length === 0) logger.warning('no network configured yet: POST /config/apply { id: <caip2>, values } or open /config/ui/seal.html');
};

init().then(() => {
  logger.info('Server started successfully');
}).catch((err) => {
  logger.error('Error starting server', err);
  process.exit(1);
});

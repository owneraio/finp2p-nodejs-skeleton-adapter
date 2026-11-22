import express from 'express';
import path from 'path';
import { readFileSync } from 'fs';
import { Wallet } from 'ethers';
import { logger as expressLogger } from 'express-winston';
import { format, transports } from 'winston';
import process from 'process';
import * as routes from '@owneraio/finp2p-nodejs-skeleton-adapter';
import {
  logger,
  PluginManager,
  PlanApprovalServiceImpl,
  PaymentsServiceImpl,
  ProofProvider,
  AccountMappingServiceImpl,
  NetworkAccountServiceImpl,
  NotSupportedNetworkAccountService,
  workflows,
  storage as skeletonStorage,
  config,
} from '@owneraio/finp2p-nodejs-skeleton-adapter';
import { TokenServiceImpl, EscrowServiceImpl, Storage } from './services/inmemory';
import { FinP2PClient } from '@owneraio/finp2p-client';
import { DelayedApprovals } from './plugins/delayed-approvals';
import { Pool } from 'pg';
import { pages } from './headless/schema';
import { SampleConfigHandler } from './headless/handler';

/** Headers that carry credentials: never serialised into the request log. */
const HEADER_BLACKLIST = ['authorization', 'proxy-authorization', 'cookie', 'x-api-key'];

function configureLogging(app: ReturnType<typeof express>) {
  app.use(expressLogger({
    transports: [new transports.Console()],
    format: format.combine(format.json()),
    meta: true,
    expressFormat: true,
    colorize: false,
    headerBlacklist: HEADER_BLACKLIST,
    // the config router logs its own requests with meta:false (no headers, no bodies)
    ignoreRoute: (req) => req.path.startsWith('/config'),
  }));
}

export interface AppConfig {
  connectionString?: string;
  /** An already open pool; wins over `connectionString`. The caller owns it. */
  pool?: Pool;
  /**
   * PostgreSQL schema name for skeleton tables. Defaults to `'sample_adapter'`
   * for the reference adapter; operators can override at deploy time via
   * `LEDGER_SCHEMA` (handled by the entry point in `src/index.ts`).
   */
  schemaName?: string;
  /** Opens sealed secrets. Absent = plaintext secrets only, no encryption block in GET /config. */
  sealer?: config.Sealer;
  /** Reject plaintext secrets in config requests. */
  requireSealedSecrets?: boolean;
  /** `adapter.id` in the config descriptor. */
  adapterId?: string;
}

/** Package version for the config descriptor; read at runtime so it works from src and dist. */
const packageVersion = (): string => {
  try {
    return String(JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version);
  } catch {
    return '0.0.0';
  }
};

/** Default schema name baked into the sample adapter. Real adapters should
 *  pick their own (e.g. 'sepolia', 'heder'). */
export const SAMPLE_ADAPTER_SCHEMA = 'sample_adapter';

function createApp(orgId: string, finP2PClient: FinP2PClient | undefined, options?: AppConfig) {
  const app = express();
  configureLogging(app);

  const { privateKey } = Wallet.createRandom();
  const signerPrivateKey = process.env.SIGNER_PRIVATE_KEY || privateKey;
  const proofProvider = new ProofProvider(orgId, finP2PClient, signerPrivateKey);

  const pluginManager = new PluginManager();
  if (finP2PClient) {
    pluginManager.registerPlanApprovalPlugin(new DelayedApprovals(logger));
  }

  const pool = options?.pool ?? (options?.connectionString ? new Pool({ connectionString: options.connectionString }) : undefined);
  const schemaName = options?.schemaName ?? SAMPLE_ADAPTER_SCHEMA;

  const inmemory = new Storage();
  // ledger connections: one network config per ledger (CAIP-2), applied over HTTP; assets name their ledger
  const handler = new SampleConfigHandler(inmemory);
  const configStore = pool ? new config.PgConfigStore(pool, schemaName) : new config.MemoryConfigStore();
  const runtime = new config.ConfigRuntime({
    adapter: { id: options?.adapterId ?? 'sample-adapter', kind: '@owneraio/sample-adapter', version: packageVersion() },
    pages,
    handler,
    store: configStore,
    sealer: options?.sealer,
    requireSealedSecrets: options?.requireSealedSecrets,
  });
  // before the global parser: body-parser skips an already parsed body, so the /config
  // limit (1mb) only holds when the config routes see the request first
  config.registerConfigRoutes(app, runtime);
  // demo page that seals secrets in the browser before POSTing them
  app.use('/config/ui', express.static(path.join(__dirname, '..', 'headless')));
  app.use(express.json({ limit: '50mb' }));

  // stored configs come back before any operation runs: workflow replay and new calls wait on
  // it (see `ready` below), and so does /health/readiness, so no traffic lands on an empty runtime
  const restored = runtime.restore();

  let tokenService: routes.TokenService & routes.CommonService & routes.HealthService =
    new TokenServiceImpl(inmemory, proofProvider, runtime);
  // readiness waits for restore only: a pod with no config yet must still be reachable on /config
  const healthService: routes.HealthService = {
    liveness: () => tokenService.liveness(),
    readiness: async () => { await restored; await tokenService.readiness(); },
  };
  let escrowService: routes.EscrowService = new EscrowServiceImpl(inmemory, proofProvider);
  let paymentsService: routes.PaymentService = new PaymentsServiceImpl(pluginManager);
  let planApprovalService: routes.PlanApprovalService =
    new PlanApprovalServiceImpl(orgId, pluginManager, finP2PClient);

  let mappingService: routes.AccountMappingService | undefined;
  let mappingConfig: routes.AccountMappingConfig | undefined;
  let networkAccountService: routes.NetworkAccountService = new NotSupportedNetworkAccountService();

  if (pool) {
    const workflowStorage = new workflows.WorkflowStorage(pool, schemaName);
    if (!finP2PClient) {
      logger.warning('Workflows enabled without FinP2PClient — callbacks will not be sent, router must poll for results');
    }
    const ready = () => restored;
    planApprovalService = workflows.createServiceProxy(ready, workflowStorage, finP2PClient, planApprovalService,
      'approvePlan',
      'proposeCancelPlan',
      'proposeResetPlan',
      'proposeInstructionApproval',
    );
    tokenService = workflows.createServiceProxy(ready, workflowStorage, finP2PClient, tokenService,
      'createAsset',
      'issue',
      'transfer',
      'swap',
      'redeem',
    );
    escrowService = workflows.createServiceProxy(ready, workflowStorage, finP2PClient, escrowService,
      'hold',
      'release',
      'rollback',
    );
    paymentsService = workflows.createServiceProxy(ready, workflowStorage, finP2PClient, paymentsService,
      'getDepositInstruction',
      'payout',
    );
    // tokenService also implements CommonService (operationStatus / getReceipt) — wrap with no
    // method names so the proxy intercepts only operationStatus to read from the workflow store.
    tokenService = workflows.createServiceProxy(ready, workflowStorage, finP2PClient, tokenService);

    const accountStore = new skeletonStorage.PgAccountStore(pool, schemaName);
    mappingService = new AccountMappingServiceImpl(accountStore);
    const networkAccountStore = new skeletonStorage.PgNetworkAccountStore(pool, schemaName);
    networkAccountService = new NetworkAccountServiceImpl(networkAccountStore);
    mappingConfig = {
      fields: [
        {
          field: 'ledgerAccountId',
          description: 'In-memory account identifier (derived from finId)',
          exampleValue: '0x1a2b3c4d5e6f...',
        },
      ],
    };
  }

  routes.register(
    app as any,
    tokenService,
    escrowService,
    tokenService,
    healthService,
    paymentsService,
    planApprovalService,
    networkAccountService,
    { mappingConfig, mappingService },
  );

  return {
    app, pool, runtime, handler, restored,
  };
}

export default createApp;

import express from 'express';
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
  workflows,
  storage as skeletonStorage,
} from '@owneraio/finp2p-nodejs-skeleton-adapter';
import { TokenServiceImpl, EscrowServiceImpl, Storage } from './services/inmemory';
import { FinP2PClient } from '@owneraio/finp2p-client';
import { DelayedApprovals } from './plugins/delayed-approvals';
import { Pool } from 'pg';

function configureLogging(app: ReturnType<typeof express>) {
  app.use(expressLogger({
    transports: [new transports.Console()],
    format: format.combine(format.json()),
    meta: true,
    expressFormat: true,
    colorize: false,
  }));
}

export interface AppConfig {
  connectionString?: string;
}

function createApp(orgId: string, finP2PClient: FinP2PClient | undefined, config?: AppConfig) {
  const app = express();
  app.use(express.json({ limit: '50mb' }));
  configureLogging(app);

  const { privateKey } = Wallet.createRandom();
  const signerPrivateKey = process.env.SIGNER_PRIVATE_KEY || privateKey;
  const proofProvider = new ProofProvider(orgId, finP2PClient, signerPrivateKey);

  const pluginManager = new PluginManager();
  if (finP2PClient) {
    pluginManager.registerPlanApprovalPlugin(new DelayedApprovals(logger));
  }

  const inmemory = new Storage();
  let tokenService: routes.TokenService & routes.CommonService & routes.HealthService =
    new TokenServiceImpl(inmemory, proofProvider);
  let escrowService: routes.EscrowService = new EscrowServiceImpl(inmemory, proofProvider);
  let paymentsService: routes.PaymentService = new PaymentsServiceImpl(pluginManager);
  let planApprovalService: routes.PlanApprovalService =
    new PlanApprovalServiceImpl(orgId, pluginManager, finP2PClient);

  let pool: Pool | undefined;
  let mappingService: routes.AccountMappingService | undefined;
  let mappingConfig: routes.AccountMappingConfig | undefined;

  if (config?.connectionString) {
    pool = new Pool({ connectionString: config.connectionString });

    const workflowStorage = new workflows.WorkflowStorage(pool);
    if (!finP2PClient) {
      logger.warning('Workflows enabled without FinP2PClient — callbacks will not be sent, router must poll for results');
    }
    const ready = () => Promise.resolve();
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

    const accountStore = new skeletonStorage.PgAccountStore(pool);
    mappingService = new AccountMappingServiceImpl(accountStore);
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
    tokenService,
    paymentsService,
    planApprovalService,
    mappingConfig,
    mappingService,
  );

  return { app, pool };
}

export default createApp;

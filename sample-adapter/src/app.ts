import express from 'express';
import { Wallet } from 'ethers';
import { logger as expressLogger } from 'express-winston';
import { format, transports } from 'winston';
import process from 'process';
import * as routes from '@owneraio/finp2p-nodejs-skeleton-adapter';
import { logger, PluginManager, PlanApprovalServiceImpl, PaymentsServiceImpl, ProofProvider } from '@owneraio/finp2p-nodejs-skeleton-adapter';
import { TokenServiceImpl, EscrowServiceImpl, Storage } from './services/inmemory';
import { FinP2PClient } from '@owneraio/finp2p-client';
import { DelayedApprovals } from './plugins/delayed-approvals';

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

  const storage = new Storage();
  const tokenService = new TokenServiceImpl(storage, proofProvider);
  const escrowService = new EscrowServiceImpl(storage, proofProvider);
  const paymentsService = new PaymentsServiceImpl(pluginManager);
  const planApprovalService = new PlanApprovalServiceImpl(orgId, pluginManager, finP2PClient);

  const mappingConfig = config?.connectionString ? {
    fields: [
      {
        field: 'ledgerAccountId',
        description: 'In-memory account identifier (derived from finId)',
        exampleValue: '0x1a2b3c4d5e6f...',
      },
    ],
  } : undefined;

  const { storage: workflowStorage } = routes.register(
    app as any,
    tokenService,
    escrowService,
    tokenService,
    tokenService,
    paymentsService,
    planApprovalService,
    pluginManager,
    config?.connectionString,
    finP2PClient,
    mappingConfig,
  );

  return { app, workflowStorage };
}

export default createApp;

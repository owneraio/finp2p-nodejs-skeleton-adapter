import express, { Application } from 'express';
import { Wallet } from 'ethers';
import { logger as expressLogger } from 'express-winston';
import { format, transports } from 'winston';
import process from 'process';
import * as routes from '@owneraio/finp2p-nodejs-skeleton-adapter';
import { logger, PluginManager,PlanApprovalServiceImpl, PaymentsServiceImpl, ProofProvider } from '@owneraio/finp2p-nodejs-skeleton-adapter';
import { TokenServiceImpl, EscrowServiceImpl, Storage } from './services/inmemory';
import { FinP2PClient } from '@owneraio/finp2p-client';
import { DelayedApprovals } from './plugins/delayed-approvals';

function configureLogging(app: Application) {
  app.use(
    expressLogger({
      transports: [new transports.Console({ level: process.env.LOG_LEVEL || 'info' })],
      format: format.combine(
        format.timestamp(),
        format(function dynamicContent(info) {
          if (info.timestamp) {
            info.time = info.timestamp;
            delete info.timestamp;
          }
          if (info.message) {
            info.msg = info.message;
            // @ts-ignore
            delete info.message;
          }
          return info;
        })(),
        format.json(),
      ),
      meta: true,
      expressFormat: true,
      statusLevels: true,
      ignoreRoute: (req) => req.url.toLowerCase() === '/healthcheck',
    }),
  );
}

function createApp(orgId: string, finP2PClient: FinP2PClient | undefined) {
  const app = express();
  app.use(express.json({ limit: '50mb' }));
  configureLogging(app);

  const { privateKey } = Wallet.createRandom();
  const signerPrivateKey = process.env.SIGNER_PRIVATE_KEY || privateKey;
  const proofProvider = new ProofProvider(orgId, finP2PClient, signerPrivateKey);

  const pluginManager = new PluginManager();
  if (finP2PClient) {
    pluginManager.registerPlanApprovalPlugin({ isAsync: true, asyncIface: new DelayedApprovals(orgId, finP2PClient, logger) });
  }

  const storage = new Storage();
  const tokenService = new TokenServiceImpl(storage, proofProvider);
  const escrowService = new EscrowServiceImpl(storage, proofProvider);
  const paymentsService = new PaymentsServiceImpl(pluginManager);
  const planApprovalService = new PlanApprovalServiceImpl(orgId, pluginManager, finP2PClient);

  routes.register(
    app,
    tokenService,
    escrowService,
    tokenService,
    tokenService,
    paymentsService,
    planApprovalService,
    pluginManager,
  );

  return app;
}

export default createApp;

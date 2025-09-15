import express, { Application } from 'express';
import { logger as expressLogger } from 'express-winston';
import { format, transports } from 'winston';
import process from 'process';
import * as routes from '../lib/routes';
import { TokenServiceImpl } from './services/inmemory/tokens';
import { EscrowServiceImpl } from './services/inmemory/escrow';
import { PaymentsServiceImpl } from './services/inmemory/payments';
import { AccountService } from './services/inmemory/accounts';
import { PlanApprovalServiceImpl } from '../lib/services/plan/plans';

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

function createApp() {
  const app = express();
  app.use(express.json({ limit: '50mb' }));
  configureLogging(app);

  const accountService = new AccountService();
  const tokenService = new TokenServiceImpl(accountService);
  const escrowService = new EscrowServiceImpl(accountService);
  const paymentsService = new PaymentsServiceImpl();
  const planApprovalService = new PlanApprovalServiceImpl();

  routes.register(
    app,
    tokenService,
    escrowService,
    tokenService,
    tokenService,
    paymentsService,
    planApprovalService,
  );

  return app;
}

export default createApp;

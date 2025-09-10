import * as express from 'express';
import * as routes from './routes';
import {
  EscrowService,
  TokenService,
  PaymentService,
  PlanApprovalService,
  CommonService,
  HealthService,
} from '../services';

export const register = (app: express.Application,
  tokenService: TokenService,
  escrowService: EscrowService,
  commonService: CommonService,
  healthService: HealthService,
  paymentService: PaymentService,
  planService: PlanApprovalService) => {
  // define a route handler for the default home page
  app.get('/', (req, res) => {
    res.send('OK');
  });

  routes.register(app, tokenService, escrowService, commonService, healthService, paymentService, planService);
};

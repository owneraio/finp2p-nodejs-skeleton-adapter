import {
  CommonService,
  Destination,

  EscrowService,
  HealthService,
  AccountMappingService,
  PaymentService,
  PlanApprovalService,
  Source,
  TokenService,
  pendingAssetCreation,
  pendingDepositOperation,
  pendingPlan,
  pendingReceiptOperation,
} from '../models';
import { Application } from 'express';
import { PluginManager } from '../plugins';
import { logger } from '../helpers';
import { errorHandler } from './errors';
import {
  assetBindingOptFromAPI, assetDenominationOptFromAPI,
  assetFromAPI,
  assetIdentifierOptFromAPI,
  balanceToAPI,
  createAssetOperationToAPI,
  depositAssetFromAPI,
  depositOperationToAPI,
  destinationFromAPI,
  destinationOptFromAPI,
  executionContextOptFromAPI, finIdAccountFromAPI,
  operationStatusToAPI, planApprovalOperationToAPI, planProposalFromAPI,
  receiptOperationToAPI,
  signatureFromAPI,
  signatureOptFromAPI,
  sourceFromAPI,
} from './mapping';
import { components as LedgerAPI, operations as LedgerOperations } from './model-gen';
import { createServiceProxy, WorkflowStorage } from '../workflows';
import { PgAccountStore } from '../storage';
import { AccountMappingConfig, registerMappingRoutes } from './operational';
import { AccountMappingServiceImpl } from '../services/mapping';
import { FinP2PClient } from '@owneraio/finp2p-client';
import { Pool } from 'pg';

const basePath = 'api';

const mapIfDefined = <T, R>(value: T | undefined, mapper: (val: T) => R): R | undefined => {
  if (value === undefined) return undefined;
  return mapper(value);
};

export const register = (app: Application,
  tokenService: TokenService,
  escrowService: EscrowService,
  commonService: CommonService,
  healthService: HealthService,
  paymentService: PaymentService,
  planService: PlanApprovalService,
  pluginManager: PluginManager | undefined,
  connectionString?: string,
  finP2PClient?: FinP2PClient,
  mappingConfig?: AccountMappingConfig,
  mappingService?: AccountMappingService,
) => {
  if (mappingConfig && !connectionString && !mappingService) {
    throw new Error('mappingConfig without connectionString requires a custom mappingService — built-in mapping storage needs PostgreSQL.');
  }

  const storage = connectionString ? new WorkflowStorage({ connectionString }) : undefined;
  const pool = connectionString ? new Pool({ connectionString }) : undefined;
  const accountMappingStore = pool ? new PgAccountStore(pool) : undefined;
  if (storage) {
    if (!finP2PClient) {
      logger.warning('Workflows enabled without FinP2PClient — callbacks will not be sent, router must poll for results');
    }
    const ready = () => Promise.resolve();
    planService = createServiceProxy(ready, storage, finP2PClient, planService,
      'approvePlan',
      'proposeCancelPlan',
      'proposeResetPlan',
      'proposeInstructionApproval',
    );

    tokenService = createServiceProxy(ready, storage, finP2PClient, tokenService,
      'createAsset',
      'issue',
      'transfer',
      'redeem',
    );

    escrowService = createServiceProxy(ready, storage, finP2PClient, escrowService,
      'hold',
      'release',
      'rollback',
    );

    paymentService = createServiceProxy(ready, storage, finP2PClient, paymentService,
      'getDepositInstruction',
      'payout',
    );

    commonService = createServiceProxy(ready, storage, finP2PClient, commonService);
  }

  app.get('/health/liveness', async (req, res) => {
    if (req.headers['skip-vendor'] !== 'true') {
      await healthService.liveness();
    }
    res.send('OK');
  },
  );

  app.get('/health/readiness', async (req, res) => {
    if (req.headers['skip-vendor'] !== 'true') {
      await healthService.readiness();
    }
    return res.send('OK');
  },
  );

  app.get('/health', async (req, res) => {
    res.send('OK');
  },
  );

  app.post<{},
  LedgerAPI['schemas']['ApproveExecutionPlanResponse'],
  LedgerAPI['schemas']['ApproveExecutionPlanRequest']>(
    `/${basePath}/plan/approve`,
    async (req, res) => {
      const idempotencyKey = req.headers['idempotency-key'] as string | undefined ?? '';
      const { executionPlan: { id } } = req.body;
      const approveOp = await planService.approvePlan(idempotencyKey, id);
      return res.send(planApprovalOperationToAPI(approveOp));
    },
  );

  app.post<{},
  LedgerAPI['schemas']['ApproveExecutionPlanResponse'],
  LedgerAPI['schemas']['executionPlanProposalRequest']>(
    `/${basePath}/plan/proposal`,
    async (req, res) => {
      const idempotencyKey = req.headers['idempotency-key'] as string | undefined ?? '';
      const { executionPlan: { id, proposal } } = req.body;
      let result;
      switch (proposal.proposalType) {
        case 'cancel':
          result = await planService.proposeCancelPlan(idempotencyKey, id);
          break;
        case 'reset':
          result = await planService.proposeResetPlan(idempotencyKey, id, proposal.proposedSequence);
          break;
        case 'instruction':
          result = await planService.proposeInstructionApproval(idempotencyKey, id, proposal.instructionSequence);
          break;
      }
      return res.send(planApprovalOperationToAPI(result));
    },
  );

  app.post<{},
  {},
  LedgerAPI['schemas']['executionPlanProposalStatusRequest']>(
    `/${basePath}/plan/proposal/status`,
    async (req, res) => {
      const { status, request: { executionPlan: { id, proposal } } } = req.body;
      await planService.proposalStatus(id, planProposalFromAPI(proposal), status);
      return res.status(204).send();
    },
  );

  app.post<{},
  LedgerAPI['schemas']['CreateAssetResponse'],
  LedgerAPI['schemas']['CreateAssetRequest']>(
    `/${basePath}/assets/create`,
    async (req, res, next) => {
      const idempotencyKey = req.headers['idempotency-key'] as string | undefined ?? '';
      const { asset, ledgerAssetBinding, metadata, name, issuerId, denomination, assetIdentifier } = req.body;

      const result = await tokenService.createAsset(
        idempotencyKey,
        assetFromAPI(asset),
        assetBindingOptFromAPI(ledgerAssetBinding),
        metadata,
        name,
        issuerId,
        assetDenominationOptFromAPI(denomination),
        assetIdentifierOptFromAPI(assetIdentifier),
      );
      return res.send(createAssetOperationToAPI(result));
    });

  app.post<{},
  LedgerAPI['schemas']['GetAssetBalanceResponse'],
  LedgerAPI['schemas']['GetAssetBalanceRequest']>(
    `/${basePath}/assets/getBalance`,
    async (req, res) => {
      const { asset, owner: { finId } } = req.body;
      const balance = await tokenService.getBalance(assetFromAPI(asset), finId);
      res.send({ asset, balance });
    });

  app.post<{}, LedgerAPI['schemas']['AssetBalanceInfoResponse'], LedgerAPI['schemas']['AssetBalanceInfoRequest']>(`/${basePath}/asset/balance`, async (req, res) => {
    const { asset, account } = req.body;
    const { finId } = account;
    const balance = await tokenService.balance(assetFromAPI(asset), finId);
    res.send(balanceToAPI(asset, account, balance));
  },
  );

  app.post<{},
  LedgerAPI['schemas']['IssueAssetsResponse'],
  LedgerAPI['schemas']['IssueAssetsRequest']>(
    `/${basePath}/assets/issue`,
    async (req, res) => {
      const ik = req.headers['idempotency-key'] as string | undefined ?? '';
      const { asset, quantity, destination, /*signature,*/ executionContext } = req.body;
      const ast = assetFromAPI(asset);
      const finIdAcc = finIdAccountFromAPI(destination);
      const dst: Destination = { finId: finIdAcc.finId, account: finIdAcc };
      // const sgn = signatureFromAPI(signature); // it's not provided by the router currently
      const exCtx = executionContextOptFromAPI(executionContext);

      const rsp = await tokenService.issue(ik, ast, finIdAcc, quantity, exCtx);

      res.json(receiptOperationToAPI(rsp));
    });

  app.post<{},
  LedgerAPI['schemas']['TransferAssetResponse'],
  LedgerAPI['schemas']['TransferAssetRequest']>(
    `/${basePath}/assets/transfer`,
    async (req, res) => {
      const ik = req.headers['idempotency-key'] as string | undefined ?? '';
      const { nonce, source, destination, asset, quantity, signature, executionContext } = req.body;
      const src = sourceFromAPI(source);
      const dst = destinationFromAPI(destination);
      const ast = assetFromAPI(asset);
      const sgn = signatureFromAPI(signature);
      const exCtx = executionContextOptFromAPI(executionContext);

      const rsp = await tokenService.transfer(ik, nonce, src, dst, ast, quantity, sgn, exCtx);

      res.json(receiptOperationToAPI(rsp));
    });

  app.post<{},
  LedgerAPI['schemas']['RedeemAssetsResponse'],
  LedgerAPI['schemas']['RedeemAssetsRequest']>(
    `/${basePath}/assets/redeem`,
    async (req, res) => {
      const ik = req.headers['idempotency-key'] as string | undefined ?? '';
      const { nonce, source, asset, quantity, operationId, signature, executionContext } = req.body;
      const finIdAcc = finIdAccountFromAPI(source);
      const src: Source = { finId: finIdAcc.finId, account: finIdAcc };
      const ast = assetFromAPI(asset);
      const sgn = signatureFromAPI(signature);
      const exCtx = executionContextOptFromAPI(executionContext);

      const rsp = await tokenService.redeem(ik, nonce, finIdAcc, ast, quantity, operationId, sgn, exCtx);
      res.json(receiptOperationToAPI(rsp));
    });

  app.get<LedgerOperations['getReceipt']['parameters']['path'],
  LedgerAPI['schemas']['GetReceiptResponse'], {}>(
    `/${basePath}/assets/receipts/:transactionId`,
    async (req, res) => {
      const { transactionId } = req.params;
      const receiptResult = await commonService.getReceipt(transactionId);
      res.json(receiptOperationToAPI(receiptResult));
    });


  app.post<{},
  LedgerAPI['schemas']['HoldOperationResponse'],
  LedgerAPI['schemas']['HoldOperationRequest']>(
    `/${basePath}/assets/hold`,
    async (req, res) => {
      const ik = req.headers['idempotency-key'] as string | undefined ?? '';
      const { nonce, source, destination, asset, quantity, operationId, signature, executionContext } = req.body;
      const src = sourceFromAPI(source);
      const dst = destinationOptFromAPI(destination);
      const ast = assetFromAPI(asset);
      const sgn = signatureFromAPI(signature);
      const exCtx = executionContextOptFromAPI(executionContext);

      const rsp = await escrowService.hold(ik, nonce, src, dst, ast, quantity, sgn, operationId, exCtx);
      res.json(receiptOperationToAPI(rsp));
    });

  app.post<{},
  LedgerAPI['schemas']['ReleaseOperationResponse'],
  LedgerAPI['schemas']['ReleaseOperationRequest']>(
    `/${basePath}/assets/release`,
    async (req, res) => {
      const ik = req.headers['idempotency-key'] as string | undefined ?? '';
      const { source, destination, asset, quantity, operationId, executionContext } = req.body;
      const src = sourceFromAPI(source);
      const dst = destinationFromAPI(destination);
      const ast = assetFromAPI(asset);
      const exCtx = executionContextOptFromAPI(executionContext);

      const rsp = await escrowService.release(ik, src, dst, ast, quantity, operationId, exCtx);

      res.json(receiptOperationToAPI(rsp));
    });

  app.post<{},
  LedgerAPI['schemas']['RollbackOperationResponse'],
  LedgerAPI['schemas']['RollbackOperationRequest']>(
    `/${basePath}/assets/rollback`,
    async (req, res) => {
      const ik = req.headers['idempotency-key'] as string | undefined ?? '';
      const { source, asset, quantity, operationId, executionContext } = req.body;
      const src = sourceFromAPI(source);
      const ast = assetFromAPI(asset);
      const exCtx = executionContextOptFromAPI(executionContext);

      const rsp = await escrowService.rollback(ik, src, ast, quantity, operationId, exCtx);

      res.json(receiptOperationToAPI(rsp));
    });

  app.post<{},
  LedgerAPI['schemas']['DepositInstructionResponse'],
  LedgerAPI['schemas']['DepositInstructionRequest']>(
    `/${basePath}/payments/depositInstruction/`,
    async (req, res) => {
      const idempotencyKey = req.headers['idempotency-key'] as string | undefined ?? '';
      const { owner, destination, asset, amount, details, nonce, signature } = req.body;
      const depositOp = await paymentService.getDepositInstruction(
        idempotencyKey,
        sourceFromAPI(owner),
        destinationFromAPI(destination),
        depositAssetFromAPI(asset),
        amount,
        details,
        nonce,
        signatureOptFromAPI(signature),
      );
      res.json(depositOperationToAPI(depositOp));
    });

  app.post<{},
  LedgerAPI['schemas']['PayoutResponse'],
  LedgerAPI['schemas']['PayoutRequest']>(
    `/${basePath}/payments/payout`,
    async (req, res) => {
      const idempotencyKey = req.headers['idempotency-key'] as string | undefined ?? '';
      const { source, destination, quantity, asset, payoutInstruction, nonce, signature } = req.body;
      let description: string | undefined = undefined;
      if (payoutInstruction) {
        description = payoutInstruction.description;
      }
      const receiptOp = await paymentService.payout(
        idempotencyKey,
        sourceFromAPI(source),
        destinationOptFromAPI(destination),
        assetFromAPI(asset),
        quantity,
        description,
        nonce,
        signatureOptFromAPI(signature),
      );
      res.json(receiptOperationToAPI(receiptOp));
    });

  app.get<LedgerOperations['getOperation']['parameters']['path'],
  LedgerAPI['schemas']['GetOperationStatusResponse'], {}>(
    `/${basePath}/operations/status/:cid`,
    async (req, res) => {
      const status = await commonService.operationStatus(req.params.cid);
      res.json(operationStatusToAPI(status));
    });

  if (mappingConfig) {
    registerMappingRoutes(app, mappingConfig, mappingService ?? new AccountMappingServiceImpl(accountMappingStore!));
  }

  app.use(errorHandler);

  return { storage, accountMappingStore };
};

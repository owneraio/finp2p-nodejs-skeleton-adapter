import {
  CommonService,
  Destination,
  EscrowService,
  HealthService,
  PaymentService,
  PlanApprovalService,
  Source,
  TokenService,
  pendingAssetCreation,
  pendingDepositOperation,
  pendingPlan,
  pendingReceiptOperation,
} from '@owneraio/finp2p-adapter-models';
import { Application } from 'express';
import { PluginManager } from '../plugins';
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
  operationStatusToAPI, planApprovalOperationToAPI,
  receiptOperationToAPI,
  signatureFromAPI,
  signatureOptFromAPI,
  sourceFromAPI,
} from './mapping';
import { components as LedgerAPI, operations as LedgerOperations } from './model-gen';
import { Config, migrateIfNeeded, createServiceProxy, Storage } from '../workflows';

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
  workflowConfig: Config | undefined,
) => {
  const migrationJob = mapIfDefined(workflowConfig, c => migrateIfNeeded(c.migration)) ?? Promise.resolve();
  const storage = mapIfDefined(workflowConfig, (c) => new Storage(c.storage));
  if (storage) {
    planService = createServiceProxy(() => migrationJob, storage, workflowConfig?.service, planService,
      'approvePlan',
    );

    tokenService = createServiceProxy(() => migrationJob, storage, workflowConfig?.service, tokenService,
      'createAsset',
      'issue',
      'transfer',
      'redeem',
    );

    escrowService = createServiceProxy(() => migrationJob, storage, workflowConfig?.service, escrowService,
      'hold',
      'release',
      'rollback',
    );

    paymentService = createServiceProxy(() => migrationJob, storage, workflowConfig?.service, paymentService,
      'getDepositInstruction',
      'payout',
    );

    commonService = createServiceProxy(() => migrationJob, storage, workflowConfig?.service, commonService);
  }

  app.get('/health/liveness', async (req, res) => {
    if (req.headers['skip-vendor'] !== 'true') {
      await healthService.liveness();
    }
    res.send('OK');
  },
  );

  app.get('/health/readiness', async (req, res) => {
    await migrationJob;
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
  LedgerAPI['schemas']['CreateAssetResponse'],
  LedgerAPI['schemas']['CreateAssetRequest']>(
    `/${basePath}/assets/create`,
    async (req, res, next) => {
      const idempotencyKey = req.headers['idempotency-key'] as string | undefined ?? '';
      const { asset, ledgerAssetBinding, metadata, name, issuerId, denomination } = req.body;

      const result = await tokenService.createAsset(
        idempotencyKey,
        assetFromAPI(asset),
        assetBindingOptFromAPI(ledgerAssetBinding),
        metadata,
        name,
        issuerId,
        assetDenominationOptFromAPI(denomination),
      );
      return res.send(createAssetOperationToAPI(result));
    });

  app.post<{},
  LedgerAPI['schemas']['GetAssetBalanceResponse'],
  LedgerAPI['schemas']['GetAssetBalanceRequest']>(
    `/${basePath}/assets/getBalance`,
    async (req, res) => {
      const { owner: { finId, asset } } = req.body;
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
      const { quantity, destination, /*signature,*/ executionContext } = req.body;
      const asset = destination.asset
      const ast = assetFromAPI(asset);
      const dst: Destination = { finId: destination.finId, account: { type: 'finId', finId: destination.finId } };
      // const sgn = signatureFromAPI(signature); // it's not provided by the router currently
      const exCtx = executionContextOptFromAPI(executionContext);

      pluginManager?.getTransactionHook()?.preTransaction(ik, 'issue', undefined, dst, ast, quantity, undefined, exCtx);
      const rsp = await tokenService.issue(ik, ast, dst, quantity, exCtx);
      pluginManager?.getTransactionHook()?.postTransaction(ik, 'issue', undefined, dst, ast, quantity, undefined, exCtx, rsp);

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

      pluginManager?.getTransactionHook()?.preTransaction(ik, 'transfer', src, dst, ast, quantity, sgn, exCtx);
      const rsp = await tokenService.transfer(ik, nonce, src, dst, ast, quantity, sgn, exCtx);
      pluginManager?.getTransactionHook()?.postTransaction(ik, 'transfer', src, dst, ast, quantity, sgn, exCtx, rsp);

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

      pluginManager?.getTransactionHook()?.preTransaction(ik, 'redeem', src, undefined, ast, quantity, sgn, exCtx);
      const rsp = await tokenService.redeem(ik, nonce, finIdAcc, ast, quantity, operationId, sgn, exCtx);
      pluginManager?.getTransactionHook()?.postTransaction(ik, 'redeem', src, undefined, ast, quantity, sgn, exCtx, rsp);
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

      pluginManager?.getTransactionHook()?.preTransaction(ik, 'hold', src, dst, ast, quantity, sgn, exCtx);
      const rsp = await escrowService.hold(ik, nonce, src, dst, ast, quantity, sgn, operationId, exCtx);
      pluginManager?.getTransactionHook()?.postTransaction(ik, 'hold', src, dst, ast, quantity, sgn, exCtx, rsp);
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

      pluginManager?.getTransactionHook()?.preTransaction(ik, 'release', src, dst, ast, quantity, undefined, exCtx);
      const rsp = await escrowService.release(ik, src, dst, ast, quantity, operationId, exCtx);
      pluginManager?.getTransactionHook()?.postTransaction(ik, 'release', src, dst, ast, quantity, undefined, exCtx, rsp);

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

      pluginManager?.getTransactionHook()?.preTransaction(ik, 'rollback', src, undefined, ast, quantity, undefined, exCtx);
      const rsp = await escrowService.rollback(ik, src, ast, quantity, operationId, exCtx);
      pluginManager?.getTransactionHook()?.postTransaction(ik, 'rollback', src, undefined, ast, quantity, undefined, exCtx, rsp);

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

  app.use(errorHandler);

};

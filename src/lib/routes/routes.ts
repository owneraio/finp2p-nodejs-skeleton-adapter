import {Application} from 'express';
import {components as LedgerAPI, operations as LedgerOperations} from './model-gen';
import {
  assetFromAPI,
  createAssetOperationToAPI,
  destinationFromAPI,
  signatureFromAPI,
  sourceFromAPI,
  receiptOperationToAPI, balanceToAPI, destinationOptFromAPI, operationStatusToAPI, planApprovalOperationToAPI,
  depositOperationToAPI, signatureOptFromAPI, depositAssetFromAPI, executionContextOptFromAPI, finIdAccountFromAPI,
  assetBindingOptFromAPI, assetDenominationOptFromAPI,
  assetIdentifierOptFromAPI,
} from './mapping';
import {
  CommonService,
  EscrowService,
  HealthService,
  PlanApprovalService,
  TokenService,
  PaymentService, Destination, Source,
} from '../services';
import {PluginManager} from "../plugins";
import {errorHandler} from "./errors";

const basePath = 'api';

export const register = (app: Application,
                         tokenService: TokenService,
                         escrowService: EscrowService,
                         commonService: CommonService,
                         healthService: HealthService,
                         paymentService: PaymentService,
                         planService: PlanApprovalService,
                         pluginManager: PluginManager | undefined
) => {


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
      const {executionPlan: {id}} = req.body;
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
      const {asset, ledgerAssetBinding, metadata, name, issuerId, denomination, assetIdentifier} = req.body;

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
      const {asset, owner: {finId}} = req.body;
      const {assetId} = assetFromAPI(asset);
      const balance = await tokenService.getBalance(assetId, finId);
      res.send({asset, balance});
    });

  app.post<{}, LedgerAPI['schemas']['AssetBalanceInfoResponse'], LedgerAPI['schemas']['AssetBalanceInfoRequest']>(`/${basePath}/asset/balance`, async (req, res) => {
      const {asset, account} = req.body;
      const {assetId} = assetFromAPI(asset);
      const {finId} = account;
      const balance = await tokenService.balance(assetId, finId);
      res.send(balanceToAPI(asset, account, balance));
    },
  );

  app.post<{},
    LedgerAPI['schemas']['IssueAssetsResponse'],
    LedgerAPI['schemas']['IssueAssetsRequest']>(
    `/${basePath}/assets/issue`,
    async (req, res) => {
      const ik = req.headers['idempotency-key'] as string | undefined ?? '';
      const {asset, quantity, destination, /*signature,*/ executionContext} = req.body;
      const ast = assetFromAPI(asset);
      const finIdAcc = finIdAccountFromAPI(destination);
      const dst: Destination = {finId: finIdAcc.finId, account: finIdAcc};
      // const sgn = signatureFromAPI(signature); // it's not provided by the router currently
      const exCtx = executionContextOptFromAPI(executionContext);

      pluginManager?.getTransactionHook()?.preTransaction(ik, 'issue', undefined, dst, ast, quantity, undefined, exCtx);
      const rsp = await tokenService.issue(ik, ast, finIdAcc, quantity, exCtx);
      pluginManager?.getTransactionHook()?.postTransaction(ik, 'issue', undefined, dst, ast, quantity, undefined, exCtx, rsp);

      res.json(receiptOperationToAPI(rsp));
    });

  app.post<{},
    LedgerAPI['schemas']['TransferAssetResponse'],
    LedgerAPI['schemas']['TransferAssetRequest']>(
    `/${basePath}/assets/transfer`,
    async (req, res) => {
      const ik = req.headers['idempotency-key'] as string | undefined ?? '';
      const {nonce, source, destination, asset, quantity, signature, executionContext} = req.body;
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
      const {nonce, source, asset, quantity, operationId, signature, executionContext} = req.body;
      const finIdAcc = finIdAccountFromAPI(source);
      const src: Source = {finId: finIdAcc.finId, account: finIdAcc};
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
      const {transactionId} = req.params;
      const receiptResult = await commonService.getReceipt(transactionId);
      res.json(receiptOperationToAPI(receiptResult));
    });


  app.post<{},
    LedgerAPI['schemas']['HoldOperationResponse'],
    LedgerAPI['schemas']['HoldOperationRequest']>(
    `/${basePath}/assets/hold`,
    async (req, res) => {
      const ik = req.headers['idempotency-key'] as string | undefined ?? '';
      const {nonce, source, destination, asset, quantity, operationId, signature, executionContext} = req.body;
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
      const {source, destination, asset, quantity, operationId, executionContext} = req.body;
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
      const {source, asset, quantity, operationId, executionContext} = req.body;
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
      const {owner, destination, asset, amount, details, nonce, signature} = req.body;
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
      const {source, destination, quantity, asset, payoutInstruction, nonce, signature} = req.body;
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

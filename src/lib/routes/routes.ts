import express, {Request, Response, NextFunction} from 'express';
import {components as LedgerAPI, operations as LedgerOperations} from './model-gen';
import {
  assetFromAPI,
  createAssetOperationToAPI,
  destinationFromAPI,
  signatureFromAPI,
  sourceFromAPI,
  receiptOperationToAPI, balanceToAPI, destinationOptFromAPI, operationStatusToAPI, planApprovalOperationToAPI,
  depositOperationToAPI, signatureOptFromAPI, depositAssetFromAPI, executionContextOptFromAPI, finIdAccountFromAPI,
} from './mapping';
import {
  CommonService,
  EscrowService,
  HealthService,
  PlanApprovalService,
  TokenService,
  PaymentService,
} from '../services';

const basePath = "api"

export const register = (app: express.Application,
                         tokenService: TokenService,
                         escrowService: EscrowService,
                         commonService: CommonService,
                         healthService: HealthService,
                         paymentService: PaymentService,
                         planService: PlanApprovalService,
) => {

  app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    const status = err.status || 500;
    const message = err.message || "Internal Server Error";

    // Log the error (your logger instead of console)
    console.error("Error middleware caught:", err);

    res.status(status).json({
      error: message,
    });
  })

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

  app.post(`/${basePath}/plan/approve`, async (req, res) => {
      const approveOp = await planService.approvePlan(req.body);
      return res.send(planApprovalOperationToAPI(approveOp));
    },
  );

  app.post<{}, LedgerAPI['schemas']['CreateAssetResponse'], LedgerAPI['schemas']['CreateAssetRequest']>(`/${basePath}/assets/create`, async (req, res) => {
      const idempotencyKey = req.headers['Idempotency-Key'] as string | undefined ?? '';
      const {asset, ledgerAssetBinding} = req.body;
      const {assetId} = assetFromAPI(asset);
      let tokenId: string | undefined = undefined;
      if (ledgerAssetBinding) {
        ({tokenId} = ledgerAssetBinding as LedgerAPI['schemas']['ledgerTokenId']);
      }
      const result = await tokenService.createAsset(idempotencyKey, assetId, tokenId);
      return res.send(createAssetOperationToAPI(result));
    },
  );

  app.post<{}, LedgerAPI['schemas']['GetAssetBalanceResponse'], LedgerAPI['schemas']['GetAssetBalanceRequest']>(`/${basePath}/assets/getBalance`, async (req, res) => {
      const {asset, owner: {finId}} = req.body;
      const {assetId} = assetFromAPI(asset);
      const balance = await tokenService.getBalance(assetId, finId);
      res.send({asset, balance});
    },
  );

  app.post<{}, LedgerAPI['schemas']['AssetBalanceInfoResponse'], LedgerAPI['schemas']['AssetBalanceInfoRequest']>(`/${basePath}/asset/balance`, async (req, res) => {
      const {asset, account} = req.body;
      const {assetId} = assetFromAPI(asset);
      const {finId} = account;
      const balance = await tokenService.balance(assetId, finId);
      res.send(balanceToAPI(asset, account, balance));
    },
  );

  app.post<{}, LedgerAPI['schemas']['IssueAssetsResponse'], LedgerAPI['schemas']['IssueAssetsRequest']>(`/${basePath}/assets/issue`, async (req, res) => {
      const idempotencyKey = req.headers['Idempotency-Key'] as string | undefined ?? '';
      const {asset, quantity, destination, executionContext} = req.body;
      const receiptOp = await tokenService.issue(
        idempotencyKey, assetFromAPI(asset), finIdAccountFromAPI(destination), quantity, executionContextOptFromAPI(executionContext),
      );
      try {

    let r = receiptOperationToAPI(receiptOp);
    res.json(r);
      } catch (e) {
        throw e;
      }
    },
  );

  app.post<{}, LedgerAPI['schemas']['TransferAssetResponse'], LedgerAPI['schemas']['TransferAssetRequest']>(`/${basePath}/assets/transfer`, async (req, res) => {
      const idempotencyKey = req.headers['Idempotency-Key'] as string | undefined ?? '';
      const {nonce, source, destination, asset, quantity, signature, executionContext} = req.body;
      const receiptOp = await tokenService.transfer(
        idempotencyKey,
        nonce,
        sourceFromAPI(source),
        destinationFromAPI(destination),
        assetFromAPI(asset),
        quantity,
        signatureFromAPI(signature),
        executionContextOptFromAPI(executionContext),
      );
      res.json(receiptOperationToAPI(receiptOp));
    },
  );

  app.post<{}, LedgerAPI['schemas']['RedeemAssetsResponse'], LedgerAPI['schemas']['RedeemAssetsRequest']>(`/${basePath}/assets/redeem`, async (req, res) => {
      const idempotencyKey = req.headers['Idempotency-Key'] as string | undefined ?? '';
      const {nonce, source, asset, quantity, operationId, signature, executionContext} = req.body;
      const receiptOp = await tokenService.redeem(
        idempotencyKey,
        nonce,
        finIdAccountFromAPI(source),
        assetFromAPI(asset),
        quantity,
        operationId,
        signatureFromAPI(signature),
        executionContextOptFromAPI(executionContext),
      );
      res.json(receiptOperationToAPI(receiptOp));
    }
  );

  app.get<LedgerOperations['getReceipt']['parameters']['path'], LedgerAPI['schemas']['GetReceiptResponse'], {}>(`/${basePath}/assets/receipts/:transactionId`, async (req, res) => {
      const {transactionId} = req.params;
      const receiptResult = await commonService.getReceipt(transactionId);
      res.json(receiptOperationToAPI(receiptResult));
    },
  );


  app.post<{}, LedgerAPI['schemas']['HoldOperationResponse'], LedgerAPI['schemas']['HoldOperationRequest']>(`/${basePath}/assets/hold`, async (req, res) => {
      const idempotencyKey = req.headers['Idempotency-Key'] as string | undefined ?? '';
      const {nonce, source, destination, asset, quantity, operationId, signature, executionContext} = req.body;
      const receiptOp = await escrowService.hold(
        idempotencyKey,
        nonce,
        sourceFromAPI(source),
        destinationOptFromAPI(destination),
        assetFromAPI(asset),
        quantity,
        signatureFromAPI(signature),
        operationId,
        executionContextOptFromAPI(executionContext),
      );
      res.json(receiptOperationToAPI(receiptOp));
    }
  );

  app.post<{}, LedgerAPI['schemas']['ReleaseOperationResponse'], LedgerAPI['schemas']['ReleaseOperationRequest']>(`/${basePath}/assets/release`, async (req, res) => {
      const idempotencyKey = req.headers['Idempotency-Key'] as string | undefined ?? '';
      const {destination, asset, quantity, operationId, executionContext} = req.body;
      const receiptOp = await escrowService.release(
        idempotencyKey,
        destinationFromAPI(destination),
        assetFromAPI(asset),
        quantity,
        operationId,
        executionContextOptFromAPI(executionContext),
      );
      res.json(receiptOperationToAPI(receiptOp));
    }
  );

  app.post<{}, LedgerAPI['schemas']['RollbackOperationResponse'], LedgerAPI['schemas']['RollbackOperationRequest']>(`/${basePath}/assets/rollback`, async (req, res) => {
      const idempotencyKey = req.headers['Idempotency-Key'] as string | undefined ?? '';
      const {asset, quantity, operationId, executionContext} = req.body;
      const receiptOp = await escrowService.rollback(
        idempotencyKey,
        assetFromAPI(asset),
        quantity,
        operationId,
        executionContextOptFromAPI(executionContext),
      );
      res.json(receiptOperationToAPI(receiptOp));
    }
  );

  app.post<{}, LedgerAPI['schemas']['DepositInstructionResponse'], LedgerAPI['schemas']['DepositInstructionRequest']>(`/${basePath}/payments/depositInstruction/`, async (req, res) => {
      const idempotencyKey = req.headers['Idempotency-Key'] as string | undefined ?? '';
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
    }
  );

  app.post<{}, LedgerAPI['schemas']['PayoutResponse'], LedgerAPI['schemas']['PayoutRequest']>(`/${basePath}/payments/payout`, async (req, res) => {
      const idempotencyKey = req.headers['Idempotency-Key'] as string | undefined ?? '';
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
        )
      ;
      res.json(receiptOperationToAPI(receiptOp));
    }
  );

  app.get<LedgerOperations['getOperation']['parameters']['path'], LedgerAPI['schemas']['GetOperationStatusResponse'], {}>(`/${basePath}/operations/status/:cid`, async (req, res) => {
      const status = await commonService.operationStatus(req.params.cid);
      res.json(operationStatusToAPI(status));
    }
  );
};

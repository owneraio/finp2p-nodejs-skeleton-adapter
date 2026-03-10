import {
  Asset, AssetBind, AssetCreationStatus, AssetDenomination, AssetIdentifier,
  Balance, CommonService, Destination, EscrowService, ExecutionContext, FinIdAccount,
  HealthService, PlannedInboundTransferContext, InboundTransferContext, InboundTransferHook, MappingService, OperationStatus, OperationType,
  OwnerMapping, ReceiptOperation, Signature, Source,
  TokenService, ValidationError,
  failedReceiptOperation, finIdDestination, successfulAssetCreation, successfulReceiptOperation,
} from '@owneraio/finp2p-adapter-models';
import { AssetDelegate, EscrowDelegate, InboundTransferVerificationError, TransferDelegate } from './interfaces';
import { LedgerStorage } from './storage';
import { getLogger } from './logger';
import { buildReceipt, generateCid } from './utils';

export class VanillaServiceImpl implements TokenService, EscrowService, CommonService, HealthService, MappingService, InboundTransferHook {
  constructor(
    private storage: LedgerStorage,
    private transferDelegate?: TransferDelegate,
    private assetDelegate?: AssetDelegate,
    private escrowDelegate?: EscrowDelegate,
  ) {}

  // ─── TokenService ─────────────────────────────────────────────────────

  async createAsset(
    idempotencyKey: string, asset: Asset,
    assetBind: AssetBind | undefined, assetMetadata: any | undefined,
    assetName: string | undefined, issuerId: string | undefined,
    assetDenomination: AssetDenomination | undefined, assetIdentifier: AssetIdentifier | undefined,
  ): Promise<AssetCreationStatus> {
    getLogger().info(`Creating asset ${asset.assetId}`, { idempotencyKey });

    if (this.assetDelegate) {
      const result = await this.assetDelegate.createAsset(
        idempotencyKey, asset, assetBind, assetMetadata,
        assetName, issuerId, assetDenomination, assetIdentifier,
      );
      return successfulAssetCreation(result);
    }

    const tokenId = assetBind?.tokenIdentifier?.tokenId ?? generateCid();
    return successfulAssetCreation({ tokenId, reference: undefined });
  }

  async issue(
    idempotencyKey: string, asset: Asset, to: FinIdAccount,
    quantity: string, exCtx: ExecutionContext | undefined,
  ): Promise<ReceiptOperation> {
    getLogger().info(`Issuing ${quantity} of ${asset.assetId} to ${to.finId}`);

    await this.storage.ensureAccount(to.finId, asset.assetId, asset.assetType);
    const tx = await this.storage.credit(to.finId, quantity, asset.assetId, {
      idempotency_key: idempotencyKey,
      operation_type: 'issue',
      execution_context: exCtx ? { planId: exCtx.planId, sequence: exCtx.sequence } : undefined,
    }, asset.assetType);

    const receipt = buildReceipt(
      tx, asset, undefined, finIdDestination(to.finId), quantity, 'issue', exCtx, undefined,
    );
    return successfulReceiptOperation(receipt);
  }

  async transfer(
    idempotencyKey: string, nonce: string, source: Source, destination: Destination,
    asset: Asset, quantity: string, signature: Signature, exCtx: ExecutionContext | undefined,
  ): Promise<ReceiptOperation> {
    getLogger().info(`Transferring ${quantity} of ${asset.assetId} from ${source.finId} to ${destination.finId}`);

    const details = {
      idempotency_key: idempotencyKey,
      operation_type: 'transfer' as const,
      execution_context: exCtx ? { planId: exCtx.planId, sequence: exCtx.sequence } : undefined,
    };

    if (destination.account.type === 'finId') {
      await this.storage.ensureAccount(destination.finId, asset.assetId, asset.assetType);
      const tx = await this.storage.move(source.finId, destination.finId, quantity, asset.assetId, details, asset.assetType);
      const receipt = buildReceipt(
        tx, asset, source, destination, quantity, 'transfer', exCtx, undefined,
      );
      return successfulReceiptOperation(receipt);
    }

    // External destination: lock → external transfer → unlockAndDebit / unlock
    if (!this.transferDelegate) {
      return failedReceiptOperation(1, 'External transfer requires a transfer delegate');
    }

    await this.storage.lock(source.finId, quantity, asset.assetId, {
      ...details, idempotency_key: `${idempotencyKey}:hold`,
    }, asset.assetType);

    const extResult = await this.transferDelegate.outboundTransfer(
      idempotencyKey, source, destination, asset, quantity, exCtx,
    );

    if (!extResult.success) {
      await this.storage.unlock(source.finId, quantity, asset.assetId, {
        ...details, idempotency_key: `${idempotencyKey}:unlock`,
      }, asset.assetType);
      return failedReceiptOperation(1, extResult.error);
    }

    const tx = await this.storage.unlockAndDebit(source.finId, quantity, asset.assetId, {
      ...details, idempotency_key: `${idempotencyKey}:debit`,
    }, asset.assetType);
    const receipt = buildReceipt(
      tx, asset, source, destination, quantity, 'transfer', exCtx, undefined, extResult.transactionId,
    );
    return successfulReceiptOperation(receipt);
  }

  async redeem(
    idempotencyKey: string, nonce: string, source: FinIdAccount, asset: Asset,
    quantity: string, operationId: string | undefined,
    signature: Signature, exCtx: ExecutionContext | undefined,
  ): Promise<ReceiptOperation> {
    getLogger().info(`Redeeming ${quantity} of ${asset.assetId} from ${source.finId}`);

    const details = {
      idempotency_key: idempotencyKey,
      operation_id: operationId,
      operation_type: 'redeem' as const,
      execution_context: exCtx ? { planId: exCtx.planId, sequence: exCtx.sequence } : undefined,
    };

    const tx = operationId
      ? await this.storage.unlockAndDebit(source.finId, quantity, asset.assetId, details, asset.assetType)
      : await this.storage.debit(source.finId, quantity, asset.assetId, details, asset.assetType);

    const receipt = buildReceipt(
      tx, asset, { finId: source.finId, account: source }, undefined, quantity, 'redeem', exCtx, operationId,
    );
    return successfulReceiptOperation(receipt);
  }

  async getBalance(asset: Asset, finId: string): Promise<string> {
    const bal = await this.storage.getBalance(finId, asset.assetId, asset.assetType);
    return bal.available;
  }

  async balance(asset: Asset, finId: string): Promise<Balance> {
    const bal = await this.storage.getBalance(finId, asset.assetId, asset.assetType);
    return {
      current: bal.balance,
      available: bal.available,
      held: bal.held,
    };
  }

  // ─── EscrowService ────────────────────────────────────────────────────

  async hold(
    idempotencyKey: string, nonce: string, source: Source,
    destination: Destination | undefined, asset: Asset,
    quantity: string, signature: Signature, operationId: string,
    exCtx: ExecutionContext | undefined,
  ): Promise<ReceiptOperation> {
    getLogger().info('Hold operation', { source: source.finId, asset: asset.assetId, quantity, operationId });

    const details = {
      idempotency_key: idempotencyKey,
      operation_id: operationId,
      operation_type: 'hold' as const,
      execution_context: exCtx ? { planId: exCtx.planId, sequence: exCtx.sequence } : undefined,
    };

    const tx = await this.storage.lock(source.finId, quantity, asset.assetId, details, asset.assetType);

    if (this.escrowDelegate) {
      const result = await this.escrowDelegate.hold(
        idempotencyKey, source, destination, asset, quantity, operationId, exCtx,
      );
      if (!result.success) {
        await this.storage.unlock(source.finId, quantity, asset.assetId, {
          ...details, idempotency_key: `${idempotencyKey}:unlock`,
        }, asset.assetType);
        return failedReceiptOperation(1, result.error);
      }
    }

    const receipt = buildReceipt(
      tx, asset, source, destination, quantity, 'hold', exCtx, operationId,
    );
    return successfulReceiptOperation(receipt);
  }

  async release(
    idempotencyKey: string, source: Source, destination: Destination,
    asset: Asset, quantity: string, operationId: string,
    exCtx: ExecutionContext | undefined,
  ): Promise<ReceiptOperation> {
    getLogger().info('Release operation', { source: source.finId, destination: destination.finId, quantity, operationId });

    if (this.escrowDelegate) {
      const result = await this.escrowDelegate.release(
        idempotencyKey, source, destination, asset, quantity, operationId, exCtx,
      );
      if (!result.success) {
        return failedReceiptOperation(1, result.error);
      }
    }

    await this.storage.ensureAccount(destination.finId, asset.assetId, asset.assetType);
    const tx = await this.storage.unlockAndMove(
      source.finId, destination.finId, quantity, asset.assetId, {
        idempotency_key: idempotencyKey,
        operation_id: operationId,
        operation_type: 'release',
        execution_context: exCtx ? { planId: exCtx.planId, sequence: exCtx.sequence } : undefined,
      }, asset.assetType,
    );
    const receipt = buildReceipt(
      tx, asset, source, destination, quantity, 'release', exCtx, operationId,
    );
    return successfulReceiptOperation(receipt);
  }

  async rollback(
    idempotencyKey: string, source: Source, asset: Asset,
    quantity: string, operationId: string,
    exCtx: ExecutionContext | undefined,
  ): Promise<ReceiptOperation> {
    getLogger().info('Rollback operation', { source: source.finId, quantity, operationId });

    if (this.escrowDelegate) {
      const result = await this.escrowDelegate.rollback(
        idempotencyKey, source, asset, quantity, operationId, exCtx,
      );
      if (!result.success) {
        return failedReceiptOperation(1, result.error);
      }
    }

    const tx = await this.storage.unlock(source.finId, quantity, asset.assetId, {
      idempotency_key: idempotencyKey,
      operation_id: operationId,
      operation_type: 'release',
      execution_context: exCtx ? { planId: exCtx.planId, sequence: exCtx.sequence } : undefined,
    }, asset.assetType);

    const receipt = buildReceipt(
      tx, asset, source, undefined, quantity, 'release', exCtx, operationId,
    );
    return successfulReceiptOperation(receipt);
  }

  // ─── CommonService + HealthService ────────────────────────────────────

  async getReceipt(id: string): Promise<ReceiptOperation> {
    const tx = await this.storage.getTransaction(id);
    if (!tx) {
      throw new ValidationError(`Transaction ${id} not found`);
    }

    return successfulReceiptOperation({
      id: tx.id,
      asset: { assetId: tx.asset_id, assetType: tx.asset_type as any },
      source: tx.source ? { finId: tx.source, account: { type: 'finId', finId: tx.source } } : undefined,
      destination: tx.destination ? { finId: tx.destination, account: { type: 'finId', finId: tx.destination } } : undefined,
      quantity: tx.amount,
      transactionDetails: {
        transactionId: tx.id,
        operationId: tx.details?.operation_id,
      },
      tradeDetails: {
        executionContext: tx.details?.execution_context,
      },
      operationType: (tx.details?.operation_type ?? tx.action) as OperationType,
      proof: undefined,
      timestamp: tx.created_at.getTime(),
    });
  }

  async operationStatus(cid: string): Promise<OperationStatus> {
    throw new ValidationError(`Operation ${cid} not found`);
  }

  async liveness(): Promise<void> {
    await this.storage.ping();
  }

  async readiness(): Promise<void> {
    await this.storage.ping();
  }

  // ─── MappingService ──────────────────────────────────────────────────

  private toOwnerMapping(row: any): OwnerMapping {
    return { finId: row.fin_id, account: row.account };
  }

  async getOwnerMappings(finId: string): Promise<OwnerMapping[]> {
    const result = await this.storage.query(
      'SELECT fin_id, account FROM ledger_adapter.account_mappings WHERE fin_id = $1 ORDER BY created_at ASC, account ASC',
      [finId],
    );
    return result.rows.map((r: any) => this.toOwnerMapping(r));
  }

  async listOwnerMappings(): Promise<OwnerMapping[]> {
    const result = await this.storage.query(
      'SELECT fin_id, account FROM ledger_adapter.account_mappings ORDER BY created_at ASC',
    );
    return result.rows.map((r: any) => this.toOwnerMapping(r));
  }

  async saveOwnerMapping(finId: string, account: string): Promise<OwnerMapping> {
    const normalizedAccount = account.toLowerCase();
    const result = await this.storage.query(
      `INSERT INTO ledger_adapter.account_mappings (fin_id, account)
       VALUES ($1, $2)
       ON CONFLICT (fin_id, account) DO NOTHING
       RETURNING fin_id, account`,
      [finId, normalizedAccount],
    );
    if (result.rows.length === 0) {
      return { finId, account: normalizedAccount };
    }
    return this.toOwnerMapping(result.rows[0]);
  }

  async deleteOwnerMapping(finId: string, account?: string): Promise<void> {
    if (account) {
      await this.storage.query(
        'DELETE FROM ledger_adapter.account_mappings WHERE fin_id = $1 AND account = $2',
        [finId, account.toLowerCase()],
      );
    } else {
      await this.storage.query(
        'DELETE FROM ledger_adapter.account_mappings WHERE fin_id = $1',
        [finId],
      );
    }
  }

  // ─── InboundTransferHook ─────────────────────────────────────────────

  async onPlannedInboundTransfer(_idempotencyKey: string, ctx: PlannedInboundTransferContext): Promise<void> {
    const { asset, destination } = ctx;
    if (destination.type !== 'finId') {
      return;
    }
    await this.storage.ensureAccount(destination.finId, asset.assetId, asset.assetType);
  }

  async onInboundTransfer(idempotencyKey: string, ctx: InboundTransferContext): Promise<void> {
    const { planId, instructionSequence, source, asset, destination, amount, result } = ctx;

    if (result.type === 'error') {
      return;
    }

    if (destination.type !== 'finId') {
      return;
    }

    if (this.transferDelegate?.onInboundTransfer) {
      const exCtx = { planId, sequence: instructionSequence };
      await this.transferDelegate.onInboundTransfer(
        result.transactionId,
        { finId: (source as FinIdAccount).finId, account: source as FinIdAccount },
        asset,
        { finId: destination.finId, account: destination },
        amount, exCtx,
      );
    }

    await this.storage.ensureAccount(destination.finId, asset.assetId, asset.assetType);
    await this.storage.credit(destination.finId, amount, asset.assetId, {
      idempotency_key: idempotencyKey,
      operation_type: 'transfer',
      execution_context: { planId, sequence: instructionSequence },
      transaction_id: result.transactionId,
    }, asset.assetType);
  }
}

import {
  Asset, AssetBind, AssetCreationStatus, AssetDenomination, AssetIdentifier, AssetType,
  Balance, BusinessError, CommonService, Destination,
  EscrowService, ExecutionContext, FinIdAccount,
  HealthService, PlannedInboundTransferContext, InboundTransferContext, InboundTransferHook, AccountMappingService, OperationStatus, OperationType,
  AccountMapping, ReceiptOperation, Signature, Source,
  TokenService, ValidationError,
  failedReceiptOperation, finIdDestination, successfulAssetCreation, successfulReceiptOperation,
} from '@owneraio/finp2p-nodejs-skeleton-adapter';
import { AssetDelegate, DistributionService, DistributionStatus, EscrowDelegate, InboundTransferVerificationError, OmnibusDelegate, TransferDelegate } from './interfaces';
import { LedgerStorage } from './storage';
import { getLogger } from './logger';
import { buildReceipt, generateCid } from './utils';

/** Well-known finId prefix for omnibus accounts in the local ledger. */
const OMNIBUS_FIN_ID = '__omnibus__';

export class VanillaServiceImpl implements TokenService, EscrowService, CommonService, HealthService, AccountMappingService, DistributionService, InboundTransferHook {
  constructor(
    private storage: LedgerStorage,
    private transferDelegate?: TransferDelegate,
    private assetDelegate?: AssetDelegate,
    private escrowDelegate?: EscrowDelegate,
    private omnibusDelegate?: OmnibusDelegate,
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

  // ─── AccountMappingService ──────────────────────────────────────────────────

  private aggregateRows(rows: any[]): AccountMapping[] {
    const map = new Map<string, Record<string, string>>();
    for (const row of rows) {
      let fields = map.get(row.fin_id);
      if (!fields) {
        fields = {};
        map.set(row.fin_id, fields);
      }
      fields[row.field_name] = row.value;
    }
    return Array.from(map.entries()).map(([finId, fields]) => ({ finId, fields }));
  }

  async getAccounts(finIds?: string[]): Promise<AccountMapping[]> {
    if (finIds && finIds.length > 0) {
      const result = await this.storage.query(
        'SELECT * FROM ledger_adapter.account_mappings WHERE fin_id = ANY($1) ORDER BY fin_id ASC, field_name ASC',
        [finIds],
      );
      return this.aggregateRows(result.rows);
    }
    const result = await this.storage.query(
      'SELECT * FROM ledger_adapter.account_mappings ORDER BY fin_id ASC, field_name ASC',
    );
    return this.aggregateRows(result.rows);
  }

  async getByFieldValue(fieldName: string, value: string): Promise<AccountMapping[]> {
    const result = await this.storage.query(
      `SELECT DISTINCT am.* FROM ledger_adapter.account_mappings am
       WHERE am.fin_id IN (
         SELECT fin_id FROM ledger_adapter.account_mappings
         WHERE field_name = $1 AND value = $2
       )
       ORDER BY am.fin_id ASC, am.field_name ASC`,
      [fieldName, value.toLowerCase()],
    );
    return this.aggregateRows(result.rows);
  }

  async saveAccount(finId: string, fields: Record<string, string>): Promise<AccountMapping> {
    const savedFields: Record<string, string> = {};
    for (const [fieldName, rawValue] of Object.entries(fields)) {
      const value = rawValue.toLowerCase();
      await this.storage.query(
        `INSERT INTO ledger_adapter.account_mappings (fin_id, field_name, value)
         VALUES ($1, $2, $3)
         ON CONFLICT (fin_id, field_name) DO UPDATE SET value = $3, updated_at = NOW()`,
        [finId, fieldName, value],
      );
      savedFields[fieldName] = value;
    }
    return { finId, fields: savedFields };
  }

  async deleteAccount(finId: string, fieldName?: string): Promise<void> {
    if (fieldName) {
      await this.storage.query(
        'DELETE FROM ledger_adapter.account_mappings WHERE fin_id = $1 AND field_name = $2',
        [finId, fieldName],
      );
    } else {
      await this.storage.query(
        'DELETE FROM ledger_adapter.account_mappings WHERE fin_id = $1',
        [finId],
      );
    }
  }

  // ─── DistributionService ─────────────────────────────────────────────

  async syncOmnibus(assetId: string, assetType: AssetType): Promise<DistributionStatus> {
    if (!this.omnibusDelegate) {
      throw new ValidationError('Distribution requires an omnibus delegate');
    }
    const omnibusBalance = await this.omnibusDelegate.getOmnibusBalance(assetId, assetType);
    try {
      const { distributed, available } = await this.storage.syncOmnibusBalance(
        OMNIBUS_FIN_ID, assetId, omnibusBalance, assetType,
      );
      return { assetId, assetType, omnibusBalance, distributedBalance: distributed, availableBalance: available };
    } catch (e: any) {
      if (e.code === '23514') { // CHECK constraint violation — balance went negative
        throw new BusinessError(1, `on-chain balance (${omnibusBalance}) is less than already distributed`);
      }
      throw e;
    }
  }

  async getDistributionStatus(assetId: string, assetType: AssetType): Promise<DistributionStatus> {
    const { omnibusBalance, distributed, available } = await this.storage.getDistributionStatus(
      OMNIBUS_FIN_ID, assetId, assetType,
    );
    return { assetId, assetType, omnibusBalance, distributedBalance: distributed, availableBalance: available };
  }

  async distribute(finId: string, assetId: string, assetType: AssetType, amount: string): Promise<void> {
    await this.storage.ensureAccount(finId, assetId, assetType);
    await this.storage.move(OMNIBUS_FIN_ID, finId, amount, assetId, {
      idempotency_key: `distribute:${finId}:${assetId}:${Date.now()}`,
      operation_type: 'distribute',
    }, assetType);
  }

  async reclaim(finId: string, assetId: string, assetType: AssetType, amount: string): Promise<void> {
    await this.storage.move(finId, OMNIBUS_FIN_ID, amount, assetId, {
      idempotency_key: `reclaim:${finId}:${assetId}:${Date.now()}`,
      operation_type: 'reclaim',
    }, assetType);
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

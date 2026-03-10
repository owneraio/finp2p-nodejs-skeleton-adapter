import {
  CommonService, HealthService, OperationStatus, OperationType, ReceiptOperation,
  ValidationError, successfulReceiptOperation,
} from '@owneraio/finp2p-adapter-models';
import { Pool } from 'pg';
import { LedgerStorage } from './storage';

export class CommonServiceImpl implements CommonService, HealthService {
  constructor(private storage: LedgerStorage, private pool: Pool) {}

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
    // Operation status is managed by the workflow proxy layer, not the ledger.
    // This will be overridden by createServiceProxy if workflow persistence is enabled.
    throw new ValidationError(`Operation ${cid} not found`);
  }

  async liveness(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  async readiness(): Promise<void> {
    await this.pool.query('SELECT 1');
  }
}

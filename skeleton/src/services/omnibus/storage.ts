import { Pool } from 'pg';
import { BusinessError } from '@owneraio/finp2p-adapter-models';
import { randomBytes } from 'node:crypto';
import bs58 from 'bs58';

export interface OmnibusTransaction {
  id: string;
  asset_id: string;
  asset_type: string;
  source: string | null;
  destination: string | null;
  amount: string;
  source_held: string;
  destination_held: string;
  action: string;
  details: LedgerDetails;
  created_at: Date;
}

export interface OmnibusBalance {
  balance: string;
  held: string;
  available: string;
}

export interface LedgerDetails {
  idempotency_key: string;
  operation_id?: string;
  execution_context?: { planId: string; sequence: number };
}

type Action = 'credit' | 'debit' | 'lock' | 'unlock' | 'move' | 'unlock-and-move' | 'unlock-and-debit';

const generateTxId = (): string => bs58.encode(Uint8Array.from(randomBytes(32)));

/**
 * Omnibus ledger storage backed by PostgreSQL.
 * Provides atomic balance operations with idempotency via CTE-based queries,
 * ported from the Go vanilla adapter.
 */
export class OmnibusStorage {
  constructor(private pool: Pool) {}

  async ensureAccount(finId: string, assetId: string, assetType: string = 'finp2p'): Promise<void> {
    await this.pool.query(
      `INSERT INTO ledger_adapter.omnibus_accounts (fin_id, asset_id, asset_type)
       VALUES ($1, $2, $3)
       ON CONFLICT (fin_id, asset_id) DO NOTHING`,
      [finId, assetId, assetType],
    );
  }

  async credit(finId: string, amount: string, assetId: string, details: LedgerDetails, assetType: string = 'finp2p'): Promise<OmnibusTransaction> {
    return this.transfer('', finId, amount, '0', '0', assetId, assetType, 'credit', details);
  }

  async debit(finId: string, amount: string, assetId: string, details: LedgerDetails, assetType: string = 'finp2p'): Promise<OmnibusTransaction> {
    return this.transfer(finId, '', amount, '0', '0', assetId, assetType, 'debit', details);
  }

  async lock(finId: string, amount: string, assetId: string, details: LedgerDetails, assetType: string = 'finp2p'): Promise<OmnibusTransaction> {
    return this.transfer(finId, '', '0', amount, '0', assetId, assetType, 'lock', details);
  }

  async unlock(finId: string, amount: string, assetId: string, details: LedgerDetails, assetType: string = 'finp2p'): Promise<OmnibusTransaction> {
    return this.transfer(finId, '', '0', `-${amount}`, '0', assetId, assetType, 'unlock', details);
  }

  async move(srcFinId: string, dstFinId: string, amount: string, assetId: string, details: LedgerDetails, assetType: string = 'finp2p'): Promise<OmnibusTransaction> {
    if (srcFinId === dstFinId) {
      throw new BusinessError(1, `Cannot move from account to itself: ${srcFinId}`);
    }
    return this.transfer(srcFinId, dstFinId, amount, '0', '0', assetId, assetType, 'move', details);
  }

  async unlockAndMove(srcFinId: string, dstFinId: string, amount: string, assetId: string, details: LedgerDetails, assetType: string = 'finp2p'): Promise<OmnibusTransaction> {
    if (srcFinId === dstFinId) {
      throw new BusinessError(1, `Cannot move from account to itself: ${srcFinId}`);
    }
    return this.transfer(srcFinId, dstFinId, amount, `-${amount}`, '0', assetId, assetType, 'unlock-and-move', details);
  }

  async unlockAndDebit(finId: string, amount: string, assetId: string, details: LedgerDetails, assetType: string = 'finp2p'): Promise<OmnibusTransaction> {
    return this.transfer(finId, '', amount, `-${amount}`, '0', assetId, assetType, 'unlock-and-debit', details);
  }

  async getBalance(finId: string, assetId: string): Promise<OmnibusBalance> {
    const result = await this.pool.query(
      `SELECT balance::TEXT, held::TEXT, (balance - held)::TEXT AS available
       FROM ledger_adapter.omnibus_accounts
       WHERE fin_id = $1 AND asset_id = $2`,
      [finId, assetId],
    );
    if (result.rows.length === 0) {
      return { balance: '0', held: '0', available: '0' };
    }
    return result.rows[0];
  }

  async getTransaction(txId: string): Promise<OmnibusTransaction | undefined> {
    const result = await this.pool.query(
      `SELECT id, asset_id, asset_type, source, destination,
              amount::TEXT, source_held::TEXT, destination_held::TEXT,
              action, details, created_at
       FROM ledger_adapter.omnibus_transactions WHERE id = $1`,
      [txId],
    );
    return result.rows[0];
  }

  async findByOperationId(operationId: string): Promise<OmnibusTransaction | undefined> {
    const result = await this.pool.query(
      `SELECT id, asset_id, asset_type, source, destination,
              amount::TEXT, source_held::TEXT, destination_held::TEXT,
              action, details, created_at
       FROM ledger_adapter.omnibus_transactions
       WHERE details->>'operation_id' = $1`,
      [operationId],
    );
    return result.rows[0];
  }

  /**
   * Atomic CTE-based transfer operation with idempotency.
   * Ported from Go vanilla adapter's Transfer query.
   *
   * @param source - source finId (empty string for credit)
   * @param destination - destination finId (empty string for debit)
   * @param amount - transferred amount (balance delta)
   * @param sourceHeld - source held delta (positive = increase hold, negative = decrease)
   * @param destHeld - destination held delta
   */
  private async transfer(
    source: string,
    destination: string,
    amount: string,
    sourceHeld: string,
    destHeld: string,
    assetId: string,
    assetType: string,
    action: Action,
    details: LedgerDetails,
  ): Promise<OmnibusTransaction> {
    const txId = generateTxId();

    try {
      const result = await this.pool.query(
        `WITH params AS (
          SELECT $1::VARCHAR(50)  AS tx_id,
                 $2::NUMERIC      AS amount,
                 $3::NUMERIC      AS src_hold,
                 $4::NUMERIC      AS dst_hold,
                 $5::VARCHAR(255) AS source,
                 $6::VARCHAR(255) AS destination,
                 $7::VARCHAR(255) AS asset_id,
                 $8::VARCHAR(64)  AS asset_type,
                 $9::VARCHAR(64)  AS action,
                 $10::JSONB       AS details
        ),
        found_tx AS (
          SELECT t.id, t.asset_id, t.asset_type, t.source, t.destination,
                 t.amount::TEXT, t.source_held::TEXT, t.destination_held::TEXT,
                 t.action, t.details, t.created_at
          FROM ledger_adapter.omnibus_transactions t, params p
          WHERE t.details->>'idempotency_key' = p.details->>'idempotency_key'
        ),
        src_upd AS (
          UPDATE ledger_adapter.omnibus_accounts a
          SET balance = a.balance - p.amount,
              held = a.held + p.src_hold,
              updated_at = NOW()
          FROM params p
          WHERE a.fin_id = p.source
            AND a.asset_id = p.asset_id
            AND NOT EXISTS (SELECT 1 FROM found_tx)
          RETURNING a.fin_id
        ),
        dst_upd AS (
          UPDATE ledger_adapter.omnibus_accounts a
          SET balance = a.balance + p.amount,
              held = a.held + p.dst_hold,
              updated_at = NOW()
          FROM params p
          WHERE a.fin_id = p.destination
            AND a.asset_id = p.asset_id
            AND NOT EXISTS (SELECT 1 FROM found_tx)
          RETURNING a.fin_id
        ),
        insert_tx AS (
          INSERT INTO ledger_adapter.omnibus_transactions
            (id, asset_id, asset_type, source, destination, amount, source_held, destination_held, action, details)
          SELECT p.tx_id, p.asset_id, p.asset_type,
                 NULLIF(s.fin_id, ''), NULLIF(d.fin_id, ''),
                 p.amount, p.src_hold, p.dst_hold, p.action, p.details
          FROM params p
            LEFT OUTER JOIN src_upd s ON 1=1
            LEFT OUTER JOIN dst_upd d ON 1=1
          WHERE NOT EXISTS (SELECT 1 FROM found_tx)
            AND COALESCE(s.fin_id, '') = p.source
            AND COALESCE(d.fin_id, '') = p.destination
          RETURNING id, asset_id, asset_type, source, destination,
                    amount::TEXT, source_held::TEXT, destination_held::TEXT,
                    action, details, created_at
        )
        SELECT * FROM insert_tx
        UNION ALL
        SELECT * FROM found_tx`,
        [
          txId, amount, sourceHeld, destHeld,
          source, destination, assetId, assetType,
          action, JSON.stringify(details),
        ],
      );

      if (result.rows.length === 0) {
        throw new BusinessError(1, `Transfer failed: account not found for ${source || destination}`);
      }

      return result.rows[0];
    } catch (err: any) {
      if (err instanceof BusinessError) throw err;
      const msg = err.message || '';
      if (msg.includes('omnibus_accounts_balance_check') || msg.includes('omnibus_accounts_check')) {
        throw new BusinessError(1, `Insufficient balance for ${action} on account ${source || destination}`);
      }
      throw err;
    }
  }
}

import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { StorageConfig } from './config';
import bs58 from 'bs58';

export const generateCid = (): string => bs58.encode(Uint8Array.from(randomBytes(64)));

export interface Operation {
  cid: string;
  created_at: Date;
  updated_at: Date;
  method: string;
  status: 'in_progress' | 'succeeded' | 'failed';
  inputs: any;
  outputs: any;
}

export interface Asset {
  type: string;
  id: string;
  tokenStandard: 'ERC20';
  createdAt: Date;
  updatedAt: Date;
  contractAddress: string;
  decimals: number;
}

const openConnections = [] as WeakRef<Pool>[];

const cloneExcept = (obj: any, key: string): any => {
  const copy = { ...obj };
  delete copy[key];
  return copy;
};

const getFirstConnectionOrDie = (): Pool => {
  for (let weakRef of openConnections) {
    const c = weakRef.deref();
    if (!c) continue;
    if (c.ended || c.ending) continue;
    return c;
  }

  throw new Error('No open connections are established');
};

/**
 * Globally exposed function for accessing storage without constructor
 * as we don't want to enforce DI on usage side
 * It should properly function as long as client side uses workflows object.
 *
 * Example usage
 * ```
 * function approvePlan(idempotencyKey: string, planId: string) {
 *   const operation = workflows.getOperation(arguments)
 *   if (operation.state == "waiting") { ... }
 * }
 * ```
 */
export async function getOperation(inputs: Iterable<any>): Promise<Operation> {
  const serilalized: any[] = [];
  for (const el of inputs) serilalized.push(el);

  const result = await (getFirstConnectionOrDie().query('SELECT * FROM ledger_adapter.operations WHERE inputs = $1', [JSON.stringify(serilalized)]));
  return result.rows.at(0);
}

export async function getReceiptOperation(receiptId: string): Promise<Operation | undefined> {
  const result = await getFirstConnectionOrDie().query(
    `
    SELECT * FROM ledger_adapter.operations
    WHERE outputs @> jsonb_build_object('receipt', jsonb_build_object('id', $1::text))
    LIMIT 1;
    `,
    [receiptId],
  );
  return result.rows.at(0);
}

export async function getAsset(asset: { id: string, type: string }): Promise<Asset | undefined> {
  const result = await getFirstConnectionOrDie().query(
    `SELECT id, type, decimals,
      token_standard AS "tokenStandard",
      created_at AS "createdAt",
      updated_at AS "updatedAt",
      contract_address AS "contractAddress"
    FROM ledger_adapter.assets WHERE id = $1 AND type = $2`,
    [asset.id, asset.type],
  );
  return result.rows.at(0);
}

export async function saveAsset(asset: Omit<Asset, 'createdAt' | 'updatedAt'>): Promise<Asset> {
  const result = await getFirstConnectionOrDie().query(
    `INSERT INTO ledger_adapter.assets (id, type, contract_address, decimals, token_standard)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (id, type) DO UPDATE
    SET id = ledger_adapter.assets.id
    RETURNING id, type, decimals,
      token_standard AS "tokenStandard",
      created_at AS "createdAt",
      updated_at AS "updatedAt",
      contract_address AS "contractAddress";`,
    [
      asset.id,
      asset.type,
      asset.contractAddress,
      asset.decimals,
      asset.tokenStandard,
    ],
  );

  if (result.rows.length === 0) throw new Error('Failed to save asset to DB');
  return result.rows.at(0);
}

export class Storage {
  private c: Pool;

  constructor(config: StorageConfig) {
    this.c = new Pool({ connectionString: config.connectionString });
    openConnections.push(new WeakRef(this.c));
  }

  static async closeAllConnections() {
    for (let weakRef of openConnections) {
      await (weakRef.deref()?.end() ?? Promise.resolve());
    }
  }

  async closeConnections() {
    await this.c.end();
  }

  async operation(cid: string): Promise<Operation | undefined> {
    const result = await this.c.query('SELECT * FROM ledger_adapter.operations WHERE cid = $1', [cid]);
    return result.rows.at(0);
  }

  async insert(
    ix: Omit<Operation, 'created_at' | 'updated_at'>,
  ): Promise<[Operation, boolean]> {
    const c = await this.c.query(
      `INSERT INTO ledger_adapter.operations (cid, method, status, inputs, outputs)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT(inputs) DO UPDATE
      -- no-op
      SET inputs = ledger_adapter.operations.inputs
      RETURNING
        ledger_adapter.operations.*,
        (xmax = 0) AS __inserted;
      `,
      [
        ix.cid,
        ix.method,
        ix.status,
        JSON.stringify(ix.inputs),
        JSON.stringify(ix.outputs),
      ],
    );
    if (c.rows.length === 0)
      throw new Error('It seems like operation did not insert');

    return [
      cloneExcept(c.rows[0], '__inserted'),
      c.rows[0].__inserted,
    ];
  }

  async operationsAll(): Promise<Operation[]> {
    const result = await this.c.query('SELECT * FROM ledger_adapter.operations');
    return result.rows;
  }

  private async operations(opts: { status: Operation['status'], method: string }): Promise<Operation[]> {
    const result = await this.c.query('SELECT * FROM ledger_adapter.operations WHERE status = $1 AND method = $2;', [opts.status, opts.method]);
    return result.rows;
  }

  async getPendingOperations(method: string): Promise<Operation[]> {
    return this.operations({ method, status: 'in_progress' });
  }

  async getFailedOperations(method: string): Promise<Operation[]> {
    return this.operations({ method, status: 'failed' });
  }

  async getCompletedOperations(method: string): Promise<Operation[]> {
    return this.operations({ method, status: 'succeeded' });
  }

  async update(
    cid: string,
    status: Operation['status'],
    outputs: Operation['outputs'],
  ): Promise<Operation> {
    const result = await this.c.query(
      `UPDATE ledger_adapter.operations
      SET status = $1, outputs = $2, updated_at = NOW()
      WHERE cid = $3
      RETURNING *;`,
      [
        status, JSON.stringify(outputs), cid,
      ],
    );
    if (result.rows.length === 0)
      throw new Error('It seems like operation did not update');

    return result.rows[0];
  }
}

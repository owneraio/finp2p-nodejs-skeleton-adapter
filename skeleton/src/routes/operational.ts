import { Application } from 'express';
import {
  getAccountMappings,
  saveAccountMapping,
  deleteAccountMapping,
  listAccountMappings,
  AccountMapping,
} from '../workflows/storage';
import { logger } from '../helpers';
import { components as MappingAPI } from './mapping-api-gen';

type OwnerMapping = MappingAPI['schemas']['ownerMapping'];
type CreateOwnerMappingRequest = MappingAPI['schemas']['createOwnerMappingRequest'];
type CreateOwnerMappingResponse = MappingAPI['schemas']['createOwnerMappingResponse'];
type AccountMappingField = MappingAPI['schemas']['accountMappingField'];

/**
 * Hook called after an owner mapping is saved to the database.
 * Adapters can use this for ledger-specific provisioning (e.g., on-ledger credentials).
 * Return value is merged into the response (e.g. credentialCid, credentialStatus).
 */
export interface MappingProvisionHook {
  afterSave(finId: string, ledgerAccountId: string, role: string, status: string): Promise<Partial<CreateOwnerMappingResponse>>;
}

export interface MappingConfig {
  fields: AccountMappingField[];
  provisionHook?: MappingProvisionHook;
}

function toOwnerMapping(m: AccountMapping): OwnerMapping {
  return {
    finId: m.fin_id,
    role: 'investor',
    status: 'active',
    accountMappings: { ledgerAccountId: m.account },
  };
}

/**
 * Register operational mapping endpoints:
 *   POST /mapping/owners   — create/update owner mapping
 *   GET  /mapping/owners   — query mappings (optional ?finIds= filter)
 *   GET  /mapping/fields   — supported account mapping field metadata
 */
export function registerMappingRoutes(
  app: Application,
  config: MappingConfig,
): void {

  app.post('/mapping/owners', async (req, res) => {
    try {
      const body: CreateOwnerMappingRequest = req.body;
      const { finId, accountMappings, role, status } = body;

      if (!finId || !accountMappings?.ledgerAccountId) {
        res.status(400).json({ error: 'finId and accountMappings.ledgerAccountId are required' });
        return;
      }

      const ledgerAccountId = accountMappings.ledgerAccountId;
      const ownerRole = role ?? 'investor';
      const ownerStatus = status ?? 'active';

      if (ownerStatus !== 'active' && ownerStatus !== 'inactive') {
        res.status(400).json({ error: "status must be 'active' or 'inactive'" });
        return;
      }

      logger.info('Owner mapping requested', {
        finId: finId.slice(0, 20),
        ledgerAccountId: ledgerAccountId.slice(0, 20),
        status: ownerStatus,
      });

      if (ownerStatus === 'inactive') {
        await deleteAccountMapping(finId, ledgerAccountId);
        logger.info('Owner mapping disabled', { finId });
        const result: CreateOwnerMappingResponse = { finId, role: ownerRole, status: 'inactive', accountMappings: { ledgerAccountId } };
        res.json(result);
        return;
      }

      await saveAccountMapping(finId, ledgerAccountId);

      const result: CreateOwnerMappingResponse = {
        finId,
        role: ownerRole,
        status: 'active',
        accountMappings: { ledgerAccountId },
      };

      if (config.provisionHook) {
        try {
          const extra = await config.provisionHook.afterSave(finId, ledgerAccountId, ownerRole, ownerStatus);
          Object.assign(result, extra);
        } catch (e: any) {
          logger.warning('Provision hook failed', { finId, error: e.message });
        }
      }

      logger.info('Owner mapping created', { finId, ledgerAccountId });
      res.json(result);
    } catch (e: any) {
      logger.error('Owner mapping failed', { error: e.message });
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/mapping/owners', async (req, res) => {
    try {
      const finIdsParam = req.query.finIds as string | undefined;
      const filterFinIds = finIdsParam
        ? finIdsParam.split(',').map(s => s.trim()).filter(Boolean)
        : undefined;

      logger.info('Owner mapping query', { filter: filterFinIds?.length ?? 'all' });

      let mappings: AccountMapping[];
      if (filterFinIds) {
        const results = await Promise.all(filterFinIds.map(fid => getAccountMappings(fid)));
        mappings = results.flat();
      } else {
        mappings = await listAccountMappings();
      }

      const response: OwnerMapping[] = mappings.map(toOwnerMapping);
      res.json(response);
    } catch (e: any) {
      logger.error('Owner mapping query failed', { error: e.message });
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/mapping/fields', (_req, res) => {
    const response: AccountMappingField[] = config.fields;
    res.json(response);
  });
}

import { Application } from 'express';
import { AssetType, DistributionService, MappingService, OwnerMapping } from '@owneraio/finp2p-adapter-models';
import { logger } from '../helpers';
import { components as MappingAPI } from './mapping-api-gen';

type APIMappingResponse = MappingAPI['schemas']['ownerMapping'];
type CreateOwnerMappingRequest = MappingAPI['schemas']['createOwnerMappingRequest'];
type CreateOwnerMappingResponse = MappingAPI['schemas']['createOwnerMappingResponse'];
type AccountMappingField = MappingAPI['schemas']['accountMappingField'];

/**
 * Hook called after an owner mapping is saved to the database.
 * Adapters can use this for ledger-specific provisioning (e.g., on-ledger credentials).
 * Return value is merged into the response (e.g. credentialCid, credentialStatus).
 */
export interface MappingProvisionHook {
  afterSave(finId: string, ledgerAccountId: string, status: string): Promise<Partial<CreateOwnerMappingResponse>>;
}

export interface MappingConfig {
  fields: AccountMappingField[];
  provisionHook?: MappingProvisionHook;
}

function toAPIMappingResponse(m: OwnerMapping): APIMappingResponse {
  return {
    finId: m.finId,
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
  mappingService: MappingService,
): void {

  app.post('/mapping/owners', async (req, res) => {
    try {
      const body: CreateOwnerMappingRequest = req.body;
      const { finId, accountMappings, status } = body;

      if (!finId || !accountMappings?.ledgerAccountId) {
        res.status(400).json({ error: 'finId and accountMappings.ledgerAccountId are required' });
        return;
      }

      const ledgerAccountId = accountMappings.ledgerAccountId;
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
        await mappingService.deleteOwnerMapping(finId, ledgerAccountId);
        logger.info('Owner mapping disabled', { finId });
        const result: CreateOwnerMappingResponse = { finId, status: 'inactive', accountMappings: { ledgerAccountId } };
        res.json(result);
        return;
      }

      await mappingService.saveOwnerMapping(finId, ledgerAccountId);

      const result: CreateOwnerMappingResponse = {
        finId,
        status: 'active',
        accountMappings: { ledgerAccountId },
      };

      if (config.provisionHook) {
        try {
          const extra = await config.provisionHook.afterSave(finId, ledgerAccountId, ownerStatus);
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
      const finIds = finIdsParam
        ? finIdsParam.split(',').map(s => s.trim()).filter(Boolean)
        : undefined;

      logger.info('Owner mapping query', { filter: finIds?.length ?? 'all' });

      const mappings = await mappingService.getOwnerMappings(finIds);

      const response: APIMappingResponse[] = mappings.map(toAPIMappingResponse);
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

/**
 * Register distribution endpoints:
 *   GET  /distribution/status?assetId=&assetType=  — omnibus vs distributed balance
 *   POST /distribution/distribute                  — allocate omnibus value to investor
 *   POST /distribution/reclaim                     — return investor value to undistributed pool
 */
export function registerDistributionRoutes(
  app: Application,
  distributionService: DistributionService,
): void {

  app.get('/distribution/status', async (req, res) => {
    try {
      const assetId = req.query.assetId as string;
      const assetType = (req.query.assetType as AssetType) ?? 'finp2p';
      if (!assetId) {
        res.status(400).json({ error: 'assetId query parameter is required' });
        return;
      }
      const status = await distributionService.getDistributionStatus(assetId, assetType);
      res.json(status);
    } catch (e: any) {
      logger.error('Distribution status failed', { error: e.message });
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/distribution/distribute', async (req, res) => {
    try {
      const { finId, assetId, assetType, amount } = req.body;
      if (!finId || !assetId || !amount) {
        res.status(400).json({ error: 'finId, assetId, and amount are required' });
        return;
      }
      await distributionService.distribute(finId, assetId, assetType ?? 'finp2p', amount);
      res.json({ status: 'ok' });
    } catch (e: any) {
      logger.error('Distribution failed', { error: e.message });
      const code = e.name === 'BusinessError' ? 409 : 500;
      res.status(code).json({ error: e.message });
    }
  });

  app.post('/distribution/reclaim', async (req, res) => {
    try {
      const { finId, assetId, assetType, amount } = req.body;
      if (!finId || !assetId || !amount) {
        res.status(400).json({ error: 'finId, assetId, and amount are required' });
        return;
      }
      await distributionService.reclaim(finId, assetId, assetType ?? 'finp2p', amount);
      res.json({ status: 'ok' });
    } catch (e: any) {
      logger.error('Reclaim failed', { error: e.message });
      const code = e.name === 'BusinessError' ? 409 : 500;
      res.status(code).json({ error: e.message });
    }
  });
}

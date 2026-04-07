import { Application } from 'express';
import { MappingService, MappingValidator, NetworkMapping, NetworkMappingService, NetworkMappingValidator, OwnerMapping, ValidationError } from '../models';
import { logger } from '../helpers';
import { components as MappingAPI } from './mapping-api-gen';

type APIMappingResponse = MappingAPI['schemas']['ownerMapping'];
type CreateOwnerMappingRequest = MappingAPI['schemas']['createOwnerMappingRequest'];
type CreateOwnerMappingResponse = MappingAPI['schemas']['createOwnerMappingResponse'];
type MappingField = MappingAPI['schemas']['mappingField'];
type APINetworkMapping = MappingAPI['schemas']['networkMapping'];
type CreateNetworkMappingRequest = MappingAPI['schemas']['createNetworkMappingRequest'];

const FIN_ID_HEX_PATTERN = /^[0-9a-fA-F]+$/;

/**
 * Hook called after an owner mapping is saved to the database.
 * Adapters can use this for ledger-specific provisioning (e.g., on-ledger credentials).
 * Return value is merged into the response (e.g. credentialCid, credentialStatus).
 */
export interface MappingProvisionHook {
  afterSave(finId: string, accountMappings: Record<string, string>, status: string): Promise<Partial<CreateOwnerMappingResponse>>;
}

export interface MappingConfig {
  fields: MappingField[];
  provisionHook?: MappingProvisionHook;
  validator?: MappingValidator;
}

function toAPIMappingResponse(m: OwnerMapping): APIMappingResponse {
  return {
    finId: m.finId,
    accountMappings: m.fields,
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

      if (!finId || !accountMappings || Object.keys(accountMappings).length === 0) {
        res.status(400).json({ error: 'finId and accountMappings are required' });
        return;
      }

      if (!FIN_ID_HEX_PATTERN.test(finId)) {
        res.status(400).json({ error: 'finId must be a hexadecimal string' });
        return;
      }

      const ownerStatus = status ?? 'active';

      if (ownerStatus !== 'active' && ownerStatus !== 'inactive') {
        res.status(400).json({ error: "status must be 'active' or 'inactive'" });
        return;
      }

      logger.info('Owner mapping requested', {
        finId: finId.slice(0, 20),
        fields: Object.keys(accountMappings),
        status: ownerStatus,
      });

      if (ownerStatus === 'inactive') {
        await mappingService.deleteOwnerMapping(finId);
        logger.info('Owner mapping deleted', { finId });
        res.json({ finId, accountMappings });
        return;
      }

      let validatedFields = accountMappings;
      if (config.validator) {
        validatedFields = await config.validator.validate(finId, accountMappings);
      }

      await mappingService.saveOwnerMapping(finId, validatedFields);

      const result: CreateOwnerMappingResponse = {
        finId,
        accountMappings: validatedFields,
      };

      if (config.provisionHook) {
        try {
          const extra = await config.provisionHook.afterSave(finId, validatedFields, ownerStatus);
          Object.assign(result, extra);
        } catch (e: any) {
          logger.warning('Provision hook failed', { finId, error: e.message });
        }
      }

      logger.info('Owner mapping created', { finId, fields: Object.keys(validatedFields) });
      res.json(result);
    } catch (e: any) {
      if (e instanceof ValidationError) {
        res.status(400).json({ error: e.message });
        return;
      }
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
    const response: MappingField[] = config.fields;
    res.json(response);
  });
}

// ─── Network Mapping ──────────────────────────────────────────────

export interface NetworkMappingConfig {
  fields: MappingField[];
  validator?: NetworkMappingValidator;
}

export function registerNetworkMappingRoutes(
  app: Application,
  config: NetworkMappingConfig,
  networkMappingService: NetworkMappingService,
): void {

  app.post('/mapping/networks', async (req, res) => {
    try {
      const body: CreateNetworkMappingRequest = req.body;
      const { networkId, networkMappings, status } = body;

      if (!networkId || !networkMappings || Object.keys(networkMappings).length === 0) {
        res.status(400).json({ error: 'networkId and networkMappings are required' });
        return;
      }

      const networkStatus = status ?? 'active';

      if (networkStatus !== 'active' && networkStatus !== 'inactive') {
        res.status(400).json({ error: "status must be 'active' or 'inactive'" });
        return;
      }

      logger.info('Network mapping requested', { networkId, fields: Object.keys(networkMappings), status: networkStatus });

      if (networkStatus === 'inactive') {
        await networkMappingService.deleteNetworkMapping(networkId);
        logger.info('Network mapping deleted', { networkId });
        res.json({ networkId, networkMappings });
        return;
      }

      let validatedFields = networkMappings;
      if (config.validator) {
        validatedFields = await config.validator.validate(networkId, networkMappings);
      }

      await networkMappingService.saveNetworkMapping(networkId, validatedFields);

      logger.info('Network mapping created', { networkId, fields: Object.keys(validatedFields) });
      res.json({ networkId, networkMappings: validatedFields });
    } catch (e: any) {
      if (e instanceof ValidationError) {
        res.status(400).json({ error: e.message });
        return;
      }
      logger.error('Network mapping failed', { error: e.message });
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/mapping/networks', async (req, res) => {
    try {
      const networkIdsParam = req.query.networkIds as string | undefined;
      const networkIds = networkIdsParam
        ? networkIdsParam.split(',').map(s => s.trim()).filter(Boolean)
        : undefined;

      logger.info('Network mapping query', { filter: networkIds?.length ?? 'all' });

      const mappings = await networkMappingService.getNetworkMappings(networkIds);

      const response: APINetworkMapping[] = mappings.map(m => ({
        networkId: m.networkId,
        networkMappings: m.fields,
      }));
      res.json(response);
    } catch (e: any) {
      logger.error('Network mapping query failed', { error: e.message });
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/mapping/network-fields', (_req, res) => {
    res.json(config.fields);
  });
}

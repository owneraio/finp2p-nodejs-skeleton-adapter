import { Application } from 'express';
import { AccountMappingService, AccountMappingValidator, AccountMapping, ValidationError } from '../models';
import { logger } from '../helpers';
import { components as MappingAPI } from './mapping-api-gen';

type APIMappingResponse = MappingAPI['schemas']['ownerMapping'];
type CreateOwnerMappingRequest = MappingAPI['schemas']['createOwnerMappingRequest'];
type CreateOwnerMappingResponse = MappingAPI['schemas']['createOwnerMappingResponse'];
type AccountMappingField = MappingAPI['schemas']['accountMappingField'];

const FIN_ID_HEX_PATTERN = /^[0-9a-fA-F]+$/;

/**
 * Hook called after an owner mapping is saved to the database.
 * Adapters can use this for ledger-specific provisioning (e.g., on-ledger credentials).
 * Return value is merged into the response (e.g. credentialCid, credentialStatus).
 */
export interface AccountMappingHook {
  afterSave(finId: string, fields: Record<string, string>, status: string): Promise<Partial<CreateOwnerMappingResponse>>;
}

export interface AccountMappingConfig {
  fields: AccountMappingField[];
  hook?: AccountMappingHook;
  validator?: AccountMappingValidator;
}

function toAPIMappingResponse(m: AccountMapping): APIMappingResponse {
  return {
    finId: m.finId,
    status: 'active',
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
  config: AccountMappingConfig,
  mappingService: AccountMappingService,
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
        await mappingService.deleteAccount(finId);
        logger.info('Owner mapping disabled', { finId });
        const result: CreateOwnerMappingResponse = { finId, status: 'inactive', accountMappings };
        res.json(result);
        return;
      }

      let validatedFields = accountMappings;
      if (config.validator) {
        validatedFields = await config.validator.validate(finId, accountMappings);
      }

      await mappingService.saveAccount(finId, validatedFields);

      const result: CreateOwnerMappingResponse = {
        finId,
        status: 'active',
        accountMappings: validatedFields,
      };

      if (config.hook) {
        try {
          const extra = await config.hook.afterSave(finId, validatedFields, ownerStatus);
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

      const mappings = await mappingService.getAccounts(finIds);

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

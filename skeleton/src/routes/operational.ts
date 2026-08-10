import { Application } from 'express';
import {
  AccountMappingService, AccountMappingValidator, AccountMapping,
  InvestorWhitelistService, InvestorWhitelistEntry,
  ValidationError,
} from '../models';
import { logger } from '../helpers';
import { components as MappingAPI } from './mapping-api-gen';

type APIMappingResponse = MappingAPI['schemas']['ownerMapping'];
type CreateOwnerMappingRequest = MappingAPI['schemas']['createOwnerMappingRequest'];
type CreateOwnerMappingResponse = MappingAPI['schemas']['createOwnerMappingResponse'];
type AccountMappingField = MappingAPI['schemas']['accountMappingField'];
type WhitelistInvestorRequest = MappingAPI['schemas']['whitelistInvestorRequest'];
type InvestorWhitelistEntryAPI = MappingAPI['schemas']['investorWhitelistEntry'];
type DewhitelistResponse = MappingAPI['schemas']['dewhitelistInvestorResponse'];

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

const toAPIWhitelistEntry = (e: InvestorWhitelistEntry): InvestorWhitelistEntryAPI => ({
  finId: e.finId,
  assetId: e.assetId,
  config: e.config,
});

/**
 * Register operational investor-whitelist endpoints:
 *   POST   /whitelist/investors  — whitelist (finId, assetId, arbitrary config)
 *   DELETE /whitelist/investors  — dewhitelist (?finId=, optional &assetId=)
 *   GET    /whitelist/investors  — query (optional ?finId= and ?assetId=)
 */
export function registerWhitelistRoutes(
  app: Application,
  whitelistService: InvestorWhitelistService,
): void {

  app.post('/whitelist/investors', async (req, res) => {
    try {
      const body: WhitelistInvestorRequest = req.body;
      const { finId, assetId } = body ?? {};

      if (!finId || !assetId) {
        res.status(400).json({ error: 'finId and assetId are required' });
        return;
      }
      if (!FIN_ID_HEX_PATTERN.test(finId)) {
        res.status(400).json({ error: 'finId must be a hexadecimal string' });
        return;
      }

      logger.info('Investor whitelist requested', {
        finId: finId.slice(0, 20), assetId, configKeys: Object.keys(body.config ?? {}),
      });

      const entry = await whitelistService.whitelist(finId, assetId, body.config ?? {});
      res.json(toAPIWhitelistEntry(entry));
    } catch (e: any) {
      if (e instanceof ValidationError) {
        res.status(400).json({ error: e.message });
        return;
      }
      logger.error('Investor whitelist failed', { error: e.message });
      res.status(500).json({ error: e.message });
    }
  });

  app.delete('/whitelist/investors', async (req, res) => {
    try {
      const finId = req.query.finId as string | undefined;
      const assetId = req.query.assetId as string | undefined;

      if (!finId) {
        res.status(400).json({ error: 'finId is required' });
        return;
      }
      if (!FIN_ID_HEX_PATTERN.test(finId)) {
        res.status(400).json({ error: 'finId must be a hexadecimal string' });
        return;
      }

      // Removing nothing is a success so operator retries don't fail.
      const removed = await whitelistService.dewhitelist(finId, assetId);
      logger.info('Investor dewhitelisted', { finId, assetId: assetId ?? 'all', removed });

      const result: DewhitelistResponse = { finId, removed, ...(assetId ? { assetId } : {}) };
      res.json(result);
    } catch (e: any) {
      logger.error('Investor dewhitelist failed', { error: e.message });
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/whitelist/investors', async (req, res) => {
    try {
      const finId = req.query.finId as string | undefined;
      const assetId = req.query.assetId as string | undefined;

      const entries = await whitelistService.getWhitelist(finId, assetId);
      res.json(entries.map(toAPIWhitelistEntry));
    } catch (e: any) {
      logger.error('Investor whitelist query failed', { error: e.message });
      res.status(500).json({ error: e.message });
    }
  });
}

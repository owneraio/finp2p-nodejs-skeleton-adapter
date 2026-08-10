import { Application, Request, Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import {
  AccountMappingService, AccountMappingValidator, AccountMapping,
  InvestorWhitelistService, InvestorWhitelistEntry, WhitelistParty, whitelistPartyId,
  ValidationError, WhitelistRefusedError,
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
  ...(e.party.type === 'finId' ? { finId: e.party.finId } : { address: e.party.address }),
  assetId: e.assetId,
  config: e.config,
});

export interface WhitelistRouteOptions {
  /**
   * Bearer token required on every whitelist route. These endpoints grant and
   * revoke access using whatever authority the adapter holds, and a DELETE
   * without an assetId revokes a party everywhere in one call — so set this
   * unless the routes sit behind a trusted network boundary. Registration logs a
   * warning when it is absent.
   */
  authToken?: string;
  /**
   * Failed auth attempts allowed per client within {@link authFailureWindowMs}
   * before further attempts get 429. Defaults to 10; 0 disables throttling.
   *
   * This is a single-process, in-memory counter — enough to make a shared bearer
   * token impractical to brute force through one replica, but it does not
   * coordinate across replicas. A multi-replica deployment should rate-limit at
   * the ingress as well.
   */
  maxAuthFailures?: number;
  /** Window for {@link maxAuthFailures}. Defaults to 60_000ms. */
  authFailureWindowMs?: number;
}

/** Exactly one of finId / address, so a party is never ambiguous. */
const parseParty = (
  finId: string | undefined, address: string | undefined,
): WhitelistParty | { error: string } => {
  if (finId && address) {
    return { error: 'supply exactly one of finId or address, not both' };
  }
  if (finId) {
    return FIN_ID_HEX_PATTERN.test(finId)
      ? { type: 'finId', finId }
      : { error: 'finId must be a hexadecimal string' };
  }
  if (address) {
    return { type: 'address', address };
  }
  return { error: 'finId or address is required' };
};

const isPartyError = (p: WhitelistParty | { error: string }): p is { error: string } => 'error' in p;

/**
 * Register operational investor-whitelist endpoints:
 *   POST   /investor/whitelist  — whitelist (finId | address, assetId, config)
 *   DELETE /investor/whitelist  — dewhitelist (?finId=|?address=, optional &assetId=)
 *   GET    /investor/whitelist  — query (optional party and ?assetId= filters)
 */
export function registerWhitelistRoutes(
  app: Application,
  whitelistService: InvestorWhitelistService,
  options: WhitelistRouteOptions = {},
): void {
  const { authToken, maxAuthFailures = 10, authFailureWindowMs = 60_000 } = options;

  if (!authToken) {
    logger.warning(
      'Investor whitelist routes registered without an auth token — these endpoints grant and revoke '
      + 'access, and DELETE without an assetId revokes a party for every asset. Pass '
      + 'WhitelistRouteOptions.authToken or keep them behind a trusted network boundary.',
    );
  }

  const expected = Buffer.from(`Bearer ${authToken ?? ''}`);
  const failures = new Map<string, { count: number, resetAt: number }>();

  const tokenMatches = (header: string | undefined): boolean => {
    const presented = Buffer.from(header ?? '');
    // Length must be compared separately: timingSafeEqual throws on a mismatch.
    // Not constant-time across differing lengths, which leaks only the length.
    return presented.length === expected.length && timingSafeEqual(presented, expected);
  };

  const authorized = (req: Request, res: Response): boolean => {
    if (!authToken) {
      return true;
    }
    const client = req.ip ?? 'unknown';
    const now = Date.now();
    const record = failures.get(client);
    if (record && record.resetAt <= now) {
      failures.delete(client);
    }

    if (maxAuthFailures > 0) {
      const current = failures.get(client);
      if (current && current.count >= maxAuthFailures) {
        res.status(429).json({ error: 'too many failed authorization attempts' });
        return false;
      }
    }

    if (tokenMatches(req.headers.authorization)) {
      failures.delete(client);
      return true;
    }

    const current = failures.get(client);
    failures.set(client, {
      count: (current?.count ?? 0) + 1,
      resetAt: current?.resetAt ?? now + authFailureWindowMs,
    });
    logger.warning('Whitelist authorization failed', { client });
    res.status(401).json({ error: 'unauthorized' });
    return false;
  };

  const fail = (res: Response, e: any, context: string): void => {
    if (e instanceof ValidationError) {
      res.status(400).json({ error: e.message });
      return;
    }
    if (e instanceof WhitelistRefusedError) {
      // A policy refusal, not a fault — 409 so operators can tell the two apart.
      res.status(409).json({ error: e.message, mechanisms: e.mechanisms });
      return;
    }
    logger.error(context, { error: e.message });
    res.status(500).json({ error: e.message });
  };

  app.post('/investor/whitelist', async (req, res) => {
    if (!authorized(req, res)) return;
    try {
      const body: WhitelistInvestorRequest = req.body ?? {};
      const party = parseParty(body.finId, body.address);
      if (isPartyError(party)) {
        res.status(400).json({ error: party.error });
        return;
      }
      if (!body.assetId) {
        res.status(400).json({ error: 'assetId is required' });
        return;
      }

      logger.info('Investor whitelist requested', {
        party: whitelistPartyId(party).slice(0, 20),
        partyType: party.type,
        assetId: body.assetId,
        configKeys: Object.keys(body.config ?? {}),
      });

      const entry = await whitelistService.whitelist(party, body.assetId, body.config ?? {});
      res.json(toAPIWhitelistEntry(entry));
    } catch (e: any) {
      fail(res, e, 'Investor whitelist failed');
    }
  });

  app.delete('/investor/whitelist', async (req, res) => {
    if (!authorized(req, res)) return;
    try {
      const party = parseParty(req.query.finId as string | undefined, req.query.address as string | undefined);
      if (isPartyError(party)) {
        res.status(400).json({ error: party.error });
        return;
      }
      const assetId = req.query.assetId as string | undefined;

      // Removing nothing is a success so operator retries don't fail.
      const removed = await whitelistService.dewhitelist(party, assetId);
      logger.info('Investor dewhitelisted', {
        party: whitelistPartyId(party), partyType: party.type, assetId: assetId ?? 'all', removed,
      });

      const result: DewhitelistResponse = {
        ...(party.type === 'finId' ? { finId: party.finId } : { address: party.address }),
        removed,
        ...(assetId ? { assetId } : {}),
      };
      res.json(result);
    } catch (e: any) {
      fail(res, e, 'Investor dewhitelist failed');
    }
  });

  app.get('/investor/whitelist', async (req, res) => {
    if (!authorized(req, res)) return;
    try {
      const finId = req.query.finId as string | undefined;
      const address = req.query.address as string | undefined;

      let party: WhitelistParty | undefined;
      if (finId || address) {
        const parsed = parseParty(finId, address);
        if (isPartyError(parsed)) {
          res.status(400).json({ error: parsed.error });
          return;
        }
        party = parsed;
      }

      const entries = await whitelistService.getWhitelist(party, req.query.assetId as string | undefined);
      res.json(entries.map(toAPIWhitelistEntry));
    } catch (e: any) {
      fail(res, e, 'Investor whitelist query failed');
    }
  });
}

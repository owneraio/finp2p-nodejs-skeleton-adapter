import { Application } from 'express';
import { AssetType, BusinessError } from '@owneraio/finp2p-adapter-models';
import { DistributionService } from './interfaces';

/**
 * Register distribution endpoints on an Express app:
 *   POST /distribution/sync        — reconcile omnibus DB with on-chain balance
 *   GET  /distribution/status      — read-only omnibus vs distributed balance
 *   POST /distribution/distribute  — allocate omnibus value to investor
 *   POST /distribution/reclaim     — return investor value to undistributed pool
 */
export function registerDistributionRoutes(
  app: Application,
  distributionService: DistributionService,
): void {

  app.post('/distribution/sync', async (req, res) => {
    try {
      const { assetId, assetType } = req.body;
      if (!assetId) {
        res.status(400).json({ error: 'assetId is required' });
        return;
      }
      const status = await distributionService.syncOmnibus(assetId, assetType ?? 'finp2p');
      res.json(status);
    } catch (e: any) {
      const code = e instanceof BusinessError ? 409 : 500;
      res.status(code).json({ error: e.message });
    }
  });

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
      if (Number(amount) <= 0) {
        res.status(400).json({ error: 'amount must be positive' });
        return;
      }
      await distributionService.distribute(finId, assetId, assetType ?? 'finp2p', amount);
      res.json({ status: 'ok' });
    } catch (e: any) {
      const code = e instanceof BusinessError ? 409 : 500;
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
      if (Number(amount) <= 0) {
        res.status(400).json({ error: 'amount must be positive' });
        return;
      }
      await distributionService.reclaim(finId, assetId, assetType ?? 'finp2p', amount);
      res.json({ status: 'ok' });
    } catch (e: any) {
      const code = e instanceof BusinessError ? 409 : 500;
      res.status(code).json({ error: e.message });
    }
  });
}

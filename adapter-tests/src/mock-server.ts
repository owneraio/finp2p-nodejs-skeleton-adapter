import express from 'express';
import * as http from 'http';
import { sleep } from './utils/utils';

/**
 * Unified mock server for adapter tests.
 *
 * Combines:
 * - FinP2P router simulation (GraphQL asset queries, REST plan retrieval)
 * - Test helpers (plan registration, instruction completion tracking)
 * - Operation callback endpoint (async operation completion notifications)
 */
export class MockServer {
  private server: http.Server | null = null;

  private url: string | null = null;

  private readonly app: express.Application;

  // --- Plan & asset state (from MockFinP2PServer) ---
  private assets = new Map<string, string>(); // assetId → tokenId

  private plans = new Map<string, any>(); // planId → API-format plan object

  private defaultPlanFactory: ((planId: string) => any) | undefined;

  // --- Callback state (from CallbackServer) ---
  private readonly parkedMark = Symbol('parked');

  private readonly operationsCache = new Map<string, any>();

  constructor() {
    this.app = express();
    this.app.use(express.json({ limit: '50mb' }));
    this.registerRoutes();
  }

  // ---------------------------------------------------------------------------
  // Asset & plan management
  // ---------------------------------------------------------------------------

  /** Register an asset binding (called after createAsset succeeds). */
  registerAsset(assetId: string, tokenId: string): void {
    this.assets.set(assetId, tokenId);
  }

  /** Register an execution plan in raw API format. */
  registerPlan(planId: string, plan: any): void {
    this.plans.set(planId, plan);
  }

  /** Set a factory that builds an API-format plan for any unregistered planId. */
  setDefaultPlanFactory(factory: (planId: string) => any): void {
    this.defaultPlanFactory = factory;
  }

  // ---------------------------------------------------------------------------
  // Callback management
  // ---------------------------------------------------------------------------

  /** Mark a correlation ID as expected (will be fulfilled by adapter callback). */
  expectLater(cid: string): void {
    this.operationsCache.set(cid, this.parkedMark);
  }

  /** Check if a cid was marked as expected. */
  isExpectedLater(cid: string): boolean {
    return this.operationsCache.get(cid) === this.parkedMark;
  }

  /** Wait for the adapter to POST an operation result for the given cid. */
  async operation<T>(cid: string): Promise<T> {
    for (let i = 0; i < 30; i++) {
      const result = this.operationsCache.get(cid);
      if (result === this.parkedMark) {
        await sleep(500);
        continue;
      }
      if (result !== undefined) {
        return result.operation;
      }
    }
    throw new Error('Expected callback in reasonable time, but not received');
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /** Start listening. Pass port 0 for a random available port. Returns the base URL. */
  async start(port: number): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      this.server = this.app.listen(port, () => {
        const addr = this.server!.address();
        const actualPort = typeof addr === 'object' && addr ? addr.port : port;
        this.url = `http://localhost:${actualPort}`;
        resolve(this.url);
      });
      this.server.on('error', reject);
    });
  }

  /** Get the base URL of the running server. */
  getUrl(): string {
    if (!this.url) throw new Error('MockServer is not started');
    return this.url;
  }

  /** Callback server address (compatibility with old CallbackServer interface). */
  get address(): string {
    return this.getUrl();
  }

  /** Stop the server. */
  async stop(): Promise<void> {
    if (!this.server) return;
    return new Promise((resolve, reject) => {
      this.server!.closeAllConnections();
      this.server!.close((err) => (err ? reject(err) : resolve()));
      this.server = null;
      this.url = null;
    });
  }

  // ---------------------------------------------------------------------------
  // Route registration
  // ---------------------------------------------------------------------------

  private buildAssetNode(assetId: string, tokenId: string) {
    return {
      id: assetId,
      name: assetId,
      type: 'finp2p',
      organizationId: 'test-org',
      denomination: { code: 'USD' },
      issuerId: 'test-issuer',
      config: '{}',
      allowedIntents: [],
      assetIdentifier: { type: 'finp2p', value: assetId },
      certificates: { nodes: [] },
      regulationVerifiers: [],
      policies: { proof: { type: 'NoProofPolicy' } },
      ledgerAssetInfo: { tokenId, ledgerReference: null },
    };
  }

  private registerRoutes(): void {
    // 1. Operation callback (from CallbackServer)
    this.app.post('/operations/callback/:cid', (req, res) => {
      this.operationsCache.set(req.params.cid, req.body);
      res.setHeader('content-type', 'application/json').status(200).send({});
    });

    // 2. Test helper: register a plan
    this.app.post('/plans', (req, res) => {
      const plan = req.body;
      if (!plan?.id) {
        res.status(400).json({ error: "Plan must have an 'id' field" });
        return;
      }
      this.plans.set(plan.id, plan);
      res.status(201).json({ registered: plan.id });
    });

    // 3. Test helper: mark instruction completed
    this.app.post('/plans/:planId/complete/:sequence', (req, res) => {
      const { planId } = req.params;
      const sequence = parseInt(req.params.sequence, 10);
      const plan = this.plans.get(planId);
      if (!plan) {
        res.status(404).json({ error: `Plan ${planId} not found` });
        return;
      }
      if (!plan.instructionsCompletionEvents) plan.instructionsCompletionEvents = [];
      plan.instructionsCompletionEvents.push({
        instructionSequenceNumber: sequence,
        output: { type: 'receipt', id: `mock-receipt-${planId}-${sequence}` },
      });
      // Advance currentInstructionSequence to next incomplete
      const completedSeqs = new Set(plan.instructionsCompletionEvents.map((e: any) => e.instructionSequenceNumber));
      const allSeqs = (plan.instructions || []).map((i: any) => i.sequence);
      const nextIncomplete = allSeqs.find((s: number) => !completedSeqs.has(s));
      plan.currentInstructionSequence = nextIncomplete ?? allSeqs[allSeqs.length - 1] ?? 0;
      plan.executionPlanStatus = allSeqs.every((s: number) => completedSeqs.has(s)) ? 'completed' : 'approved';
      res.status(200).json({ completed: sequence, currentSequence: plan.currentInstructionSequence });
    });

    // 4. Execution plan retrieval
    this.app.get('/execution/:planId', (req, res) => {
      const planId = req.params.planId;
      const plan = this.plans.get(planId) ?? this.defaultPlanFactory?.(planId);
      if (plan) {
        res.status(200).json({ plan });
      } else {
        res.status(404).json({ error: `Plan ${planId} not found` });
      }
    });

    // 5. GraphQL catch-all (must be last)
    this.app.post('/', (req, res) => {
      try {
        const { variables } = req.body;
        const filter = variables?.filter;
        const assetId = filter?.value as string | undefined;

        if (assetId && this.assets.has(assetId)) {
          res.json({
            data: { assets: { nodes: [this.buildAssetNode(assetId, this.assets.get(assetId)!)] } },
          });
        } else if (assetId) {
          res.json({ data: { assets: { nodes: [] } } });
        } else {
          const nodes = [...this.assets.entries()].map(
            ([id, tokenId]) => this.buildAssetNode(id, tokenId),
          );
          res.json({ data: { assets: { nodes } } });
        }
      } catch (e: any) {
        res.status(400).json({ errors: [{ message: e.message }] });
      }
    });
  }
}

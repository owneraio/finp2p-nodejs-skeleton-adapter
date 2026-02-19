import * as http from 'http';

/**
 * Mock FinP2P server for plan-based tests.
 *
 * Handles:
 * - POST /  (GraphQL) — asset queries (getAsset, getAssets)
 * - GET  /execution/:planId — execution plan retrieval (getExecutionPlan)
 * - POST /plans — register a plan from test code (per-test plan injection)
 * - POST /plans/:planId/complete/:sequence — mark instruction completed
 *
 * Simulates the real FinP2P OSS (GraphQL) and FinAPI (REST) endpoints so that
 * tests can use the real FinP2PClient pointed at this mock server.
 */
export class MockFinP2PServer {
  private server: http.Server | null = null;

  private url: string | null = null;

  private assets = new Map<string, string>(); // assetId → tokenId (instrumentId)

  private plans = new Map<string, any>(); // planId → API-format plan object

  private defaultPlanFactory: ((planId: string) => any) | undefined;

  /** Register an asset binding (called after createAsset succeeds). */
  registerAsset(assetId: string, tokenId: string): void {
    this.assets.set(assetId, tokenId);
  }

  /** Register an execution plan in raw API format. */
  registerPlan(planId: string, plan: any): void {
    this.plans.set(planId, plan);
  }

  /**
   * Set a factory that builds an API-format plan for any unregistered planId.
   * Useful for tests that generate dynamic planIds.
   */
  setDefaultPlanFactory(factory: (planId: string) => any): void {
    this.defaultPlanFactory = factory;
  }

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

  /** Start listening. Pass port 0 for a random available port. Returns the base URL. */
  async start(port: number): Promise<string> {
    this.server = http.createServer((req, res) => {
      const url = req.url ?? '/';

      // REST: GET /execution/:planId
      const execMatch = url.match(/^\/execution\/(.+)$/);
      if (req.method === 'GET' && execMatch) {
        const planId = decodeURIComponent(execMatch[1]);
        const plan = this.plans.get(planId) ?? this.defaultPlanFactory?.(planId);
        if (plan) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ plan }));
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Plan ${planId} not found` }));
        }
        return;
      }

      // Test helper: POST /plans/:planId/complete/:sequence — mark instruction completed
      const completeMatch = url.match(/^\/plans\/(.+)\/complete\/(\d+)$/);
      if (req.method === 'POST' && completeMatch) {
        const planId = decodeURIComponent(completeMatch[1]);
        const sequence = parseInt(completeMatch[2], 10);
        const plan = this.plans.get(planId);
        if (!plan) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Plan ${planId} not found` }));
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
        // Update plan status if all completed
        plan.executionPlanStatus = allSeqs.every((s: number) => completedSeqs.has(s)) ? 'completed' : 'approved';
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ completed: sequence, currentSequence: plan.currentInstructionSequence }));
        return;
      }

      // Test helper: POST /plans — register a plan from test code
      if (req.method === 'POST' && url === '/plans') {
        let body = '';
        req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        req.on('end', () => {
          try {
            const plan = JSON.parse(body);
            if (!plan.id) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: "Plan must have an 'id' field" }));
              return;
            }
            this.plans.set(plan.id, plan);
            res.writeHead(201, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ registered: plan.id }));
          } catch (e: any) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: e.message }));
          }
        });
        return;
      }

      // GraphQL: POST /
      if (req.method === 'POST') {
        let body = '';
        req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        req.on('end', () => {
          try {
            const { variables } = JSON.parse(body);
            const filter = variables?.filter;
            const assetId = filter?.value as string | undefined;

            if (assetId && this.assets.has(assetId)) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                data: { assets: { nodes: [this.buildAssetNode(assetId, this.assets.get(assetId)!)] } },
              }));
            } else if (assetId) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                data: { assets: { nodes: [] } },
              }));
            } else {
              const nodes = [...this.assets.entries()].map(
                ([id, tokenId]) => this.buildAssetNode(id, tokenId),
              );
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ data: { assets: { nodes } } }));
            }
          } catch (e: any) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ errors: [{ message: e.message }] }));
          }
        });
        return;
      }

      res.writeHead(405);
      res.end();
    });

    return new Promise<string>((resolve) => {
      this.server!.listen(port, () => {
        const addr = this.server!.address();
        const actualPort = typeof addr === 'object' && addr ? addr.port : port;
        this.url = `http://localhost:${actualPort}`;
        resolve(this.url);
      });
    });
  }

  /** Get the base URL of the running server. */
  getUrl(): string {
    if (!this.url) throw new Error('MockFinP2PServer is not started');
    return this.url;
  }

  /** Stop the server. */
  async stop(): Promise<void> {
    if (!this.server) return;
    return new Promise((resolve) => {
      this.server!.close(() => resolve());
      this.server = null;
      this.url = null;
    });
  }
}

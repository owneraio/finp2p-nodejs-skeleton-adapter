import * as http from 'http';
import { FinP2PClient } from '@owneraio/finp2p-client';

/**
 * Minimal mock FinP2P router for skeleton workflow tests.
 *
 * Handles:
 * - POST /operations/callback/:cid — captures async operation callbacks
 *
 * Use a real FinP2PClient pointed at this server instead of mocking the client.
 * Based on the full mock in finp2p-canton-adapter.
 */
export class MockFinP2PServer {
  private server: http.Server | null = null;
  private callbacks = new Map<string, any>();

  getCallback(cid: string): any {
    return this.callbacks.get(cid);
  }

  getAllCallbacks(): Map<string, any> {
    return this.callbacks;
  }

  async start(port = 0): Promise<string> {
    this.server = http.createServer((req, res) => {
      const url = req.url ?? '/';

      const callbackMatch = url.match(/^\/operations\/callback\/(.+)$/);
      if (req.method === 'POST' && callbackMatch) {
        const cid = decodeURIComponent(callbackMatch[1]);
        let body = '';
        req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        req.on('end', () => {
          try {
            this.callbacks.set(cid, JSON.parse(body));
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok' }));
          } catch (e: any) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: e.message }));
          }
        });
        return;
      }

      // Default: return 200 with empty response for any other endpoint
      // (e.g. GraphQL queries the client might make during init)
      if (req.method === 'POST') {
        let body = '';
        req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        req.on('end', () => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ data: {} }));
        });
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({}));
    });

    return new Promise<string>((resolve) => {
      this.server!.listen(port, () => {
        const addr = this.server!.address() as any;
        const url = `http://localhost:${addr.port}`;
        resolve(url);
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    return new Promise((resolve) => {
      this.server!.close(() => resolve());
      this.server = null;
    });
  }
}

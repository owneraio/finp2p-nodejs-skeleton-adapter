import express from 'express';
import { sleep } from '../utils/utils';

const register = (app: express.Application, operationsCache: Map<string, any>) => {
  app.post('/operations/callback/:cid', async (req, res) => {
    operationsCache.set(req.params.cid, req.body);
  });
};

export class CallbackServer {
  private readonly parkedMark = Symbol('parked');

  constructor(
    public readonly address: string,
    public readonly app: express.Application,
    private readonly operationsCache: Map<string, any>,
  ) { }

  expectLater(cid: string) {
    this.operationsCache.set(cid, this.parkedMark);
  }

  isExpectedLater(cid: string) {
    return this.operationsCache.get(cid) === this.parkedMark;
  }

  async operation<T>(cid: string): Promise<T> {
    for (let i = 0; i < 30; i++) {
      const result = this.operationsCache.get(cid);
      if (result === this.parkedMark) {
        await sleep(500);
        continue;
      }
      if (result !== undefined) {
        return result;
      }
    }

    throw new Error('Expected callback in reasonable time, but not received');
  }
}

export const create = async (port: Number): Promise<CallbackServer> => {
  const operationsCache = new Map<string, any>();
  const app = express();
  app.use(express.json({ limit: '50mb' }));
  register(app, operationsCache);

  await new Promise<void>((resolve, reject) => {
    app.listen(port, error => {
      if (!error) {
        resolve();
      } else {
        reject(error);
      }
    });
  });

  return new CallbackServer(`http://localhost:${port}`, app, operationsCache);
};

// Shared constants and a recording ConfigHandler for the config tests.
import { AdapterConfig, ConfigError, ConfigHandler } from '../../../src/config';

export const VERSION = 'test-config/1';
export const adapter = { id: 'test-adapter', version: '0.0.0' };
export const SECRET_KEYS = ['operatorKey', 'apiKey'] as const;

export const NET = 'eip155:1';
export const NET2 = 'eip155:5';
export const RPC = 'https://rpc.example.test';
export const KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';   // anvil #1, public test key
export const API_KEY = 'hunter2-super-secret-value';

export interface FakeHandler extends ConfigHandler {
  applied: Array<{ config: AdapterConfig; previous: AdapterConfig | undefined }>;
  validated: AdapterConfig[];
  validateErrors: ConfigError[];
  /** Throw from apply while set; `failOnce` clears it after the first throw. */
  failApply?: Error;
  failOnce?: boolean;
}

export const fakeHandler = (opts: { withValidate?: boolean } = {}): FakeHandler => {
  const h: FakeHandler = {
    applied: [],
    validated: [],
    validateErrors: [],
    async apply(config, previous) {
      if (h.failApply) {
        const e = h.failApply;
        if (h.failOnce) h.failApply = undefined;
        throw e;
      }
      h.applied.push({ config, previous });
    },
  };
  if (opts.withValidate !== false) {
    h.validate = async (config) => {
      h.validated.push(config);
      return h.validateErrors;
    };
  }
  return h;
};

export const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

// In-process ConfigStore for runtime / route tests. Same contract as the pg store.
import {
  ConfigRef, ConfigStore, SaveConfigInput, StoredConfig,
} from '../../../src/config/interfaces';
import { ERROR_CODES } from '../../../src/config/types';

const codedError = (code: string, message: string): Error => Object.assign(new Error(message), { code });
const keyOf = (ref: ConfigRef): string => `${ref.kind}/${ref.id}`;

export class MemoryStore implements ConfigStore {
  readonly configs = new Map<string, StoredConfig>();

  /** Row by (kind, id); network kind when only an id is given. */
  row(id: string, kind: ConfigRef['kind'] = 'network'): StoredConfig | undefined {
    return this.configs.get(keyOf({ kind, id }));
  }

  async list(): Promise<StoredConfig[]> {
    return [...this.configs.values()].map((c) => ({ ...c }));
  }

  async get(ref: ConfigRef): Promise<StoredConfig | undefined> {
    const c = this.configs.get(keyOf(ref));
    return c ? { ...c } : undefined;
  }

  async save(input: SaveConfigInput): Promise<number> {
    const version = (this.configs.get(keyOf(input))?.version ?? 0) + 1;
    if (input.isDefault) {
      for (const c of this.configs.values()) if (c.kind === input.kind) c.isDefault = false;
    }
    this.configs.set(keyOf(input), { ...input, version, updatedAt: new Date() });
    return version;
  }

  async remove(ref: ConfigRef): Promise<void> {
    if (!this.configs.delete(keyOf(ref))) throw codedError(ERROR_CODES.notFound, `config ${keyOf(ref)} not found`);
  }
}

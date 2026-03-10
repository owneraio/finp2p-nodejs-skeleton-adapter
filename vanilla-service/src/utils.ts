import { randomBytes } from 'node:crypto';
import bs58 from 'bs58';

export const generateCid = (): string => bs58.encode(Uint8Array.from(randomBytes(64)));

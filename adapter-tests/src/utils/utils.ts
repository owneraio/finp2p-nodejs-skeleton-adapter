import * as crypto from 'crypto';

export const ASSET = 102;

export function generateId(): string {
  return `${Date.now()}${Math.floor(Math.random() * 10000)}`;
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export const randomResourceId = (orgId: string, resourceType: number) => {
  return `${orgId}:${resourceType}:${generateId()}`;
};

export const generateIdempotencyKey = () => crypto.randomUUID();

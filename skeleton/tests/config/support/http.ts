import express from 'express';
import { AddressInfo } from 'node:net';
import { Server } from 'node:http';

// the skeleton's @types/node predates the global fetch
const { fetch } = globalThis as unknown as {
  fetch: (url: string, init?: Record<string, unknown>) => Promise<{ status: number; text(): Promise<string>; headers: { get(n: string): string | null } }>;
};

export interface Res { status: number; body: any; text: string; type: string | null }

/** Serves `app` on a free port; `request` answers status, parsed body, raw text and content type. */
export async function serve(app: express.Application) {
  const server: Server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const request = async (method: string, path: string, body?: Buffer | string | object, headers: Record<string, string> = {}): Promise<Res> => {
    const raw = body === undefined || typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
    const res = await fetch(`${base}${path}`, {
      method,
      headers: raw !== undefined ? { 'content-type': 'application/json', ...headers } : headers,
      body: raw,
    });
    const text = await res.text();
    let parsed: unknown;
    try { parsed = text ? JSON.parse(text) : undefined; } catch { parsed = undefined; }
    return { status: res.status, body: parsed, text, type: res.headers.get('content-type') };
  };
  const close = () => new Promise<void>((resolve) => { (server as unknown as { closeAllConnections(): void }).closeAllConnections(); server.close(() => resolve()); });
  return { base, request, close };
}

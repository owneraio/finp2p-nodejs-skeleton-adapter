import type { FinP2PClient } from '@owneraio/finp2p-client';
import { DataIdentifier, DataItem } from './provider';

/** An item with the timestamp the publisher gave it. */
export interface StampedItem {
  item: DataItem;
  timestamp: number;
}

/**
 * What the router said of one item. `accepted` alone sets the item's marker;
 * any other status leaves it to be sent again. More statuses may be added
 * (a `skipped`, once the router reports a stale write as one).
 */
export type FeedResultStatus = 'accepted' | 'rejected';

export interface FeedResult {
  identifier: DataIdentifier;
  dataType: string;
  status: FeedResultStatus;
  reason?: string;
}

/**
 * Sends a batch to the router under a source. A throw means the router did
 * not take the batch: an `IngestRefused` that is `final` when the same batch
 * would be refused again, anything else when it is worth sending later.
 */
export type FeedIngest = (source: string, items: StampedItem[]) => Promise<FeedResult[]>;

/** The router answered a batch with an error status. */
export class IngestRefused extends Error {
  constructor(readonly status: number, detail: string) {
    super(`the router refused the batch: HTTP ${status}${detail ? ` ${detail}` : ''}`);
    this.name = 'IngestRefused';
  }

  /** Whether the same batch would be refused again: a client error, other than a timeout or a rate limit. */
  get final(): boolean {
    return this.status >= 400 && this.status < 500 && this.status !== 408 && this.status !== 429;
  }
}

/** Fails a call that has not answered in time, so one that hangs cannot hold every later round. */
export async function withTimeout<T>(call: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      call,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${what} did not answer within ${Math.round(ms / 1000)}s`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** The router's `POST /data/assets/ingest`: one entry per item, with the item's source and timestamp. */
export function routerIngest(client: Pick<FinP2PClient, 'finAPIClient'>): FeedIngest {
  return async (source, items) => {
    const { data, error, response } = await client.finAPIClient.apiClient.POST('/data/assets/ingest', {
      body: {
        source,
        assets: items.map(({ item, timestamp }) => ({
          identifier: item.identifier,
          data: [{ dataType: item.dataType, data: item.data, source, timestamp }],
        })),
      },
    });
    if (!data) throw new IngestRefused(response.status, error ? JSON.stringify(error).slice(0, 300) : '');
    return data.results.map((r) => ({
      identifier: { identifierType: r.identifier.identifierType, identifierValue: r.identifier.identifierValue },
      dataType: r.dataType,
      status: r.status,
      ...(r.error?.message ? { reason: r.error.message } : {}),
    }));
  };
}

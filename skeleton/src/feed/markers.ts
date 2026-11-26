/** One item's place on the router: its upsert key there. */
export interface FeedKey {
  source: string;
  identifierType: string;
  identifierValue: string;
  dataType: string;
}

/** What was last accepted for a key: the hash of its data and the timestamp it was sent with. */
export interface FeedMarker {
  hash: string;
  timestamp: number;
}

/** What the publisher remembers between rounds. A Postgres store replaces the in-memory one later. */
export interface FeedMarkers {
  get(key: FeedKey): Promise<FeedMarker | undefined>;
  /** The markers of these keys, in the same order, `undefined` where there is none. */
  getMany(keys: FeedKey[]): Promise<(FeedMarker | undefined)[]>;
  set(key: FeedKey, marker: FeedMarker): Promise<void>;
}

export const feedKeyId = (k: FeedKey): string => JSON.stringify([k.source, k.identifierType, k.identifierValue, k.dataType]);

/** Markers held in memory. A restart forgets them, and the first round then sends everything again. */
export class InMemoryFeedMarkers implements FeedMarkers {
  private readonly markers = new Map<string, FeedMarker>();

  async get(key: FeedKey): Promise<FeedMarker | undefined> {
    return this.markers.get(feedKeyId(key));
  }

  async getMany(keys: FeedKey[]): Promise<(FeedMarker | undefined)[]> {
    return keys.map((k) => this.markers.get(feedKeyId(k)));
  }

  async set(key: FeedKey, marker: FeedMarker): Promise<void> {
    this.markers.set(feedKeyId(key), marker);
  }
}

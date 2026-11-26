import {
  DataItem, DataProvider, FeedPublisher, FeedPublisherOptions, FeedResult, InMemoryFeedMarkers, IngestRefused,
  StampedItem, canonicalJson, contentHash, feedPublisherFromEnv, feedSettings, routerIngest, withTimeout,
} from '../../src/feed';

const header = (name: string) => ({ name, symbol: name.toUpperCase(), assetClass: 'BOND' });
const item = (isin: string, name = isin, dataType = 'assetHeader'): DataItem => ({ identifier: { identifierType: 'ISIN', identifierValue: isin }, dataType, data: header(name) });

/** A provider that lists the pages it is given, or throws after them. */
function provider(source: string, pages: () => DataItem[][], failure?: () => Error | undefined, dataTypes: string[] = ['assetHeader']): DataProvider {
  return {
    source,
    dataTypes,
    async *items() {
      for (const page of pages()) yield page;
      const e = failure?.();
      if (e) throw e;
    },
  };
}

const accept = (s: StampedItem): FeedResult => ({ identifier: s.item.identifier, dataType: s.item.dataType, status: 'accepted' });

/** A router that accepts everything unless told otherwise, and records what it was sent. */
function router(answer?: (source: string, items: StampedItem[]) => FeedResult[] | Error | undefined) {
  const calls: { source: string; isins: string[]; timestamps: number[] }[] = [];
  const ingest = async (source: string, items: StampedItem[]) => {
    calls.push({ source, isins: items.map((s) => s.item.identifier.identifierValue), timestamps: items.map((s) => s.timestamp) });
    const given = answer?.(source, items);
    if (given instanceof Error) throw given;
    return given ?? items.map(accept);
  };
  return { ingest, calls };
}

function logs() {
  const lines: { level: 'info' | 'warn' | 'error'; message: string }[] = [];
  const at = (level: 'info' | 'warn' | 'error') => (message: string) => { lines.push({ level, message }); };
  return { lines, logger: { info: at('info'), warn: at('warn'), error: at('error') } };
}

const publisherOf = (ingest: ReturnType<typeof router>['ingest'], batchSize?: number, options: Partial<FeedPublisherOptions> = {}, markers = new InMemoryFeedMarkers()) => {
  const { logger, lines } = logs();
  const publisher = new FeedPublisher(ingest, markers, logger, { intervalMs: 3_600_000, ...(batchSize ? { batchSize } : {}), ...options });
  return { publisher, lines, markers };
};

/** Gives the publisher its providers without starting its schedule, so a test runs the rounds itself. */
const give = (publisher: FeedPublisher, providers: DataProvider[]) => { (publisher as unknown as { providers: DataProvider[] }).providers = providers; };

describe('publishing providers\' items to the router', () => {
  it('sends every listed item under the provider\'s source, in batches', async () => {
    const { ingest, calls } = router();
    const { publisher } = publisherOf(ingest, 2);
    give(publisher, [provider('ownera:dtcc', () => [[item('US0000000001'), item('US0000000002')], [item('US0000000003')]])]);
    const [round] = await publisher.round();
    expect(round).toEqual({ source: 'ownera:dtcc', listed: 3, changed: 3, accepted: 3, rejected: 0 });
    expect(calls.map((c) => [c.source, c.isins])).toEqual([
      ['ownera:dtcc', ['US0000000001', 'US0000000002']],
      ['ownera:dtcc', ['US0000000003']],
    ]);
  });

  it('sends only what is new or changed on the next round', async () => {
    const { ingest, calls } = router();
    const { publisher } = publisherOf(ingest);
    let listed = [item('US0000000001'), item('US0000000002')];
    give(publisher, [provider('ownera:dtcc', () => [listed])]);
    await publisher.round();
    listed = [item('US0000000001'), item('US0000000002', 'renamed'), item('US0000000003')];
    const [round] = await publisher.round();
    expect(round).toMatchObject({ listed: 3, changed: 2, accepted: 2 });
    expect(calls[1].isins).toEqual(['US0000000002', 'US0000000003']);
    expect((await publisher.round())[0]).toMatchObject({ changed: 0, accepted: 0 });
    expect(calls).toHaveLength(2);
  });

  it('sends an item the router rejected again on the next round, and says why it was rejected', async () => {
    let reject = true;
    const { ingest, calls } = router((_s, items) => items.map((s) => (
      reject && s.item.identifier.identifierValue === 'US0000000002'
        ? { ...accept(s), status: 'rejected' as const, reason: 'issuanceMode is required' }
        : accept(s))));
    const { publisher, lines } = publisherOf(ingest);
    give(publisher, [provider('ownera:dtcc', () => [[item('US0000000001'), item('US0000000002')]])]);
    expect((await publisher.round())[0]).toMatchObject({ accepted: 1, rejected: 1 });
    expect(lines.find((l) => l.level === 'warn')?.message).toMatch(/ISIN US0000000002 assetHeader: issuanceMode is required/);
    reject = false;
    expect((await publisher.round())[0]).toMatchObject({ changed: 1, accepted: 1, rejected: 0 });
    expect(calls[1].isins).toEqual(['US0000000002']);
  });

  it('leaves a batch the router did not take for the next round, without throwing', async () => {
    let down = true;
    const { ingest, calls } = router(() => (down ? new Error('ECONNREFUSED') : undefined));
    const { publisher, lines } = publisherOf(ingest);
    give(publisher, [provider('ownera:dtcc', () => [[item('US0000000001')]])]);
    const [failed] = await publisher.round();
    expect(failed).toMatchObject({ accepted: 0, error: 'ECONNREFUSED' });
    expect(lines.find((l) => l.level === 'warn')?.message).toMatch(/ended early/);
    down = false;
    expect((await publisher.round())[0]).toMatchObject({ changed: 1, accepted: 1 });
    expect(calls).toHaveLength(2);
  });

  it('keeps what it sent before the source stopped answering', async () => {
    const { ingest } = router();
    const { publisher } = publisherOf(ingest, 1);
    let broken: Error | undefined = new Error('DTCC answered 503');
    give(publisher, [provider('ownera:dtcc', () => [[item('US0000000001')]], () => broken)]);
    expect((await publisher.round())[0]).toMatchObject({ listed: 1, accepted: 1, error: 'DTCC answered 503' });
    broken = undefined;
    expect((await publisher.round())[0]).toMatchObject({ listed: 1, changed: 0 });
  });

  it('keeps one source\'s items apart from another\'s, and goes on after one fails', async () => {
    const { ingest, calls } = router();
    const { publisher } = publisherOf(ingest);
    give(publisher, [
      provider('ownera:first', () => [], () => new Error('login expired')),
      provider('ownera:second', () => [[item('US0000000001')]]),
    ]);
    const rounds = await publisher.round();
    expect(rounds.map((r) => [r.source, r.accepted, r.error])).toEqual([['ownera:first', 0, 'login expired'], ['ownera:second', 1, undefined]]);
    expect(calls.map((c) => [c.source, c.isins])).toEqual([['ownera:second', ['US0000000001']]]);
    expect(publisher.status().sources).toEqual([
      expect.objectContaining({ source: 'ownera:first', consecutiveFailures: 1, lastRound: expect.objectContaining({ error: 'login expired' }) }),
      expect.objectContaining({ source: 'ownera:second', consecutiveFailures: 0, lastRound: expect.objectContaining({ accepted: 1 }) }),
    ]);
  });

  it('counts a batch the router refuses outright as rejected and goes on to the next, so one bad batch does not hold the rest', async () => {
    const { ingest, calls } = router((_s, items) => (items[0].item.identifier.identifierValue === 'US0000000001' ? new IngestRefused(400, 'malformed') : undefined));
    const { publisher, lines } = publisherOf(ingest, 1);
    give(publisher, [provider('ownera:dtcc', () => [[item('US0000000001'), item('US0000000002')]])]);
    const [round] = await publisher.round();
    expect(round).toEqual({ source: 'ownera:dtcc', listed: 2, changed: 2, accepted: 1, rejected: 1 });
    expect(calls.map((c) => c.isins)).toEqual([['US0000000001'], ['US0000000002']]);
    expect(lines.find((l) => l.level === 'warn')?.message).toMatch(/a batch of 1 from ISIN US0000000001 assetHeader: the router refused the batch: HTTP 400 malformed/);
    expect(publisher.status().consecutiveFailures).toBe(0);
  });

  it('ends the round on a refusal worth sending again: the router overloaded, rate limiting or failing', async () => {
    for (const status of [408, 429, 500, 503]) {
      const { ingest, calls } = router(() => new IngestRefused(status, ''));
      const { publisher } = publisherOf(ingest, 1);
      give(publisher, [provider('ownera:dtcc', () => [[item('US0000000001'), item('US0000000002')]])]);
      expect((await publisher.round())[0]).toMatchObject({ accepted: 0, rejected: 0, error: expect.stringContaining(`HTTP ${status}`) });
      expect(calls).toHaveLength(1);
    }
  });

  it('ends the round when the router does not answer in time, and is free for the next', async () => {
    let hang = true;
    const ingest = async (_source: string, items: StampedItem[]) => {
      if (hang) await new Promise(() => undefined);
      return items.map(accept);
    };
    const { publisher } = publisherOf(ingest, undefined, { ingestTimeoutMs: 20 });
    give(publisher, [provider('ownera:dtcc', () => [[item('US0000000001')]])]);
    expect((await publisher.round())[0]).toMatchObject({ error: 'the router did not answer within 0s' });
    hang = false;
    expect((await publisher.round())[0]).toMatchObject({ accepted: 1 });
  });

  it('ends the round when the source does not give a page in time', async () => {
    const { ingest, calls } = router();
    const { publisher } = publisherOf(ingest, undefined, { pageTimeoutMs: 20 });
    const stuck: DataProvider = {
      source: 'ownera:dtcc',
      dataTypes: ['assetHeader'],
      items: () => ({ [Symbol.asyncIterator]: () => ({ next: () => new Promise<IteratorResult<DataItem[]>>(() => undefined) }) }),
    };
    give(publisher, [stuck]);
    expect((await publisher.round())[0]).toMatchObject({ listed: 0, error: 'ownera:dtcc\'s list did not answer within 0s' });
    expect(calls).toEqual([]);
  });

  it('tries again sooner after a round that ended early, later each time, and at the interval once one succeeds', async () => {
    let down = true;
    const { ingest } = router(() => (down ? new Error('ECONNREFUSED') : undefined));
    const { publisher, lines } = publisherOf(ingest, undefined, { retryAfterMs: 60_000 });
    give(publisher, [provider('ownera:dtcc', () => [[item('US0000000001')]])]);
    expect(publisher.nextDelayMs()).toBe(3_600_000);
    const delays: number[] = [];
    for (let i = 0; i < 8; i += 1) { await publisher.round(); delays.push(publisher.nextDelayMs()); }
    expect(delays).toEqual([60_000, 120_000, 240_000, 480_000, 960_000, 1_920_000, 3_600_000, 3_600_000]);
    // Two failures are warnings; from the third in a row it is an error.
    expect(lines.filter((l) => l.message.includes('ended early')).map((l) => l.level).slice(0, 4)).toEqual(['warn', 'warn', 'error', 'error']);
    expect(lines.find((l) => l.level === 'error')?.message).toMatch(/3 rounds in a row/);
    down = false;
    await publisher.round();
    expect(publisher.nextDelayMs()).toBe(3_600_000);
    expect(publisher.status()).toMatchObject({
      sources: [{ source: 'ownera:dtcc', consecutiveFailures: 0, lastRound: { accepted: 1 }, lastRoundAt: expect.any(String) }],
      consecutiveFailures: 0,
      lastRoundAt: expect.any(String),
    });
  });

  it('runs one round at a time', async () => {
    const { ingest, calls } = router();
    const { publisher } = publisherOf(ingest);
    give(publisher, [provider('ownera:dtcc', () => [[item('US0000000001')]])]);
    const [a, b] = await Promise.all([publisher.round(), publisher.round()]);
    expect(a).toBe(b);
    expect(calls).toHaveLength(1);
  });

  it('starts a round when it is given providers, and remembers what it published across a handover', async () => {
    const { ingest, calls } = router();
    const { publisher } = publisherOf(ingest);
    publisher.use([provider('ownera:dtcc', () => [[item('US0000000001')]])]);
    await new Promise((resolve) => setImmediate(resolve));
    await publisher.round();
    expect(calls).toHaveLength(1);
    // A reconfiguration hands over a new provider for the same source; the item is unchanged, so nothing is sent.
    publisher.use([provider('ownera:dtcc', () => [[item('US0000000001')]])]);
    await new Promise((resolve) => setImmediate(resolve));
    await publisher.round();
    expect(calls).toHaveLength(1);
    publisher.stop();
  });

  it('reads nothing and sends nothing while it holds no provider', async () => {
    const { ingest, calls } = router();
    const { publisher } = publisherOf(ingest);
    publisher.use([]);
    expect(await publisher.round()).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('refuses two providers with one source, and a provider with no source or no data types', () => {
    const { ingest } = router();
    const { publisher } = publisherOf(ingest);
    expect(() => publisher.use([provider('ownera:dtcc', () => []), provider('ownera:dtcc', () => [])])).toThrow(/two providers share the source ownera:dtcc/);
    expect(() => publisher.use([provider('', () => [])])).toThrow(/has no source/);
    expect(() => publisher.use([provider('ownera:dtcc', () => [], undefined, [])])).toThrow(/declares no data types/);
    expect(publisher.status().sources).toEqual([]);
  });
});

describe('the markers', () => {
  it('stamps each item strictly after the marker it last had, whatever the clock says', async () => {
    let clock = 1_000;
    const { ingest, calls } = router();
    const { publisher } = publisherOf(ingest, undefined, { now: () => clock });
    let name = 'a';
    give(publisher, [provider('ownera:dtcc', () => [[item('US0000000001', name)]])]);
    await publisher.round();
    name = 'b';
    await publisher.round(); // same clock: one past the marker
    clock = 500;
    name = 'c';
    await publisher.round(); // clock went back: still one past the marker
    clock = 5_000;
    name = 'd';
    await publisher.round(); // clock ahead: the clock
    expect(calls.map((c) => c.timestamps[0])).toEqual([1_000, 1_001, 1_002, 5_000]);
  });

  it('is set only for an accepted item, with the hash and timestamp that were sent', async () => {
    const { ingest } = router((_s, items) => items.map((s) => (s.item.identifier.identifierValue === 'US0000000002' ? { ...accept(s), status: 'rejected' as const } : accept(s))));
    const { publisher, markers } = publisherOf(ingest, undefined, { now: () => 7 });
    give(publisher, [provider('ownera:dtcc', () => [[item('US0000000001'), item('US0000000002')]])]);
    await publisher.round();
    const key = (isin: string) => ({ source: 'ownera:dtcc', identifierType: 'ISIN', identifierValue: isin, dataType: 'assetHeader' });
    expect(await markers.get(key('US0000000001'))).toEqual({ hash: contentHash(header('US0000000001')), timestamp: 7 });
    expect(await markers.get(key('US0000000002'))).toBeUndefined();
  });

  it('is not set when the router gives no result for the item, or one for another data type', async () => {
    const { ingest } = router((_s, items) => items.map((s) => ({ ...accept(s), dataType: 'pricing' })));
    const { publisher, markers } = publisherOf(ingest);
    give(publisher, [provider('ownera:dtcc', () => [[item('US0000000001')]])]);
    expect((await publisher.round())[0]).toMatchObject({ accepted: 0, rejected: 1 });
    expect(await markers.getMany([{ source: 'ownera:dtcc', identifierType: 'ISIN', identifierValue: 'US0000000001', dataType: 'assetHeader' }])).toEqual([undefined]);
  });

  it('keeps one marker per data type of the same asset', async () => {
    const { ingest, calls } = router();
    const { publisher } = publisherOf(ingest);
    give(publisher, [provider('ownera:dtcc', () => [[item('US0000000001'), item('US0000000001', 'US0000000001', 'pricing')]], undefined, ['assetHeader', 'pricing'])]);
    expect((await publisher.round())[0]).toMatchObject({ changed: 2, accepted: 2 });
    expect((await publisher.round())[0]).toMatchObject({ changed: 0 });
    expect(calls).toHaveLength(1);
  });
});

describe('what a provider lists', () => {
  it('refuses an item of a data type the provider did not declare, without sending it', async () => {
    const { ingest, calls } = router();
    const { publisher, lines } = publisherOf(ingest);
    give(publisher, [provider('ownera:dtcc', () => [[item('US0000000001'), item('US0000000002', 'x', 'pricing')]])]);
    expect((await publisher.round())[0]).toEqual({ source: 'ownera:dtcc', listed: 2, changed: 1, accepted: 1, rejected: 1 });
    expect(calls[0].isins).toEqual(['US0000000001']);
    expect(lines.find((l) => l.level === 'warn')?.message).toMatch(/ISIN US0000000002 pricing: data type not declared by ownera:dtcc/);
  });

  it('sends an item listed twice in a round once, the first listed, and says so', async () => {
    const { ingest, calls } = router();
    const { publisher, lines } = publisherOf(ingest, 1);
    give(publisher, [provider('ownera:dtcc', () => [[item('US0000000001', 'first')], [item('US0000000001', 'second')]])]);
    expect((await publisher.round())[0]).toMatchObject({ listed: 2, changed: 1, accepted: 1 });
    expect(calls.map((c) => c.isins)).toEqual([['US0000000001']]);
    expect(lines.find((l) => l.level === 'warn')?.message).toMatch(/listed more than once in a round, sent once: ISIN US0000000001 assetHeader/);
  });

  it('is unchanged when only the order of its keys changed', async () => {
    const { ingest, calls } = router();
    const { publisher } = publisherOf(ingest);
    let data: Record<string, unknown> = { name: 'Bond', nested: { b: 1, a: [{ y: 2, x: 1 }] } };
    give(publisher, [provider('ownera:dtcc', () => [[{ identifier: { identifierType: 'ISIN', identifierValue: 'US0000000001' }, dataType: 'assetHeader', data }]])]);
    await publisher.round();
    data = { nested: { a: [{ x: 1, y: 2 }], b: 1 }, name: 'Bond' };
    expect((await publisher.round())[0]).toMatchObject({ changed: 0 });
    expect(calls).toHaveLength(1);
  });
});

describe('the canonical hash', () => {
  it('sorts keys at every depth, keeps array order, and drops undefined as JSON does', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { f: 1, e: 2 }], c: undefined } })).toBe('{"a":{"d":[3,{"e":2,"f":1}]},"b":1}');
    expect(contentHash({ a: 1, b: 2 })).toBe(contentHash({ b: 2, a: 1 }));
    expect(contentHash({ a: [1, 2] })).not.toBe(contentHash({ a: [2, 1] }));
  });
});

describe('the router\'s ingest call', () => {
  const clientOf = (answer: { data?: unknown; error?: unknown; status?: number }) => {
    const posted: { path: string; body: unknown }[] = [];
    const client = { finAPIClient: { apiClient: { POST: async (path: string, init: { body: unknown }) => {
      posted.push({ path, body: init.body });
      return { data: answer.data, error: answer.error, response: { status: answer.status ?? 200 } };
    } } } };
    return { ingest: routerIngest(client as never), posted };
  };

  it('posts one entry per item, with its source and timestamp, and reads each result', async () => {
    const { ingest, posted } = clientOf({ data: { results: [
      { identifier: { identifierType: 'ISIN', identifierValue: 'US0000000001' }, dataType: 'assetHeader', status: 'accepted' },
      { identifier: { identifierType: 'ISIN', identifierValue: 'US0000000002' }, dataType: 'pricing', status: 'rejected', error: { code: 1, message: 'bad price' } },
    ] } });
    const results = await ingest('ownera:dtcc', [{ item: item('US0000000001'), timestamp: 10 }, { item: item('US0000000002', 'x', 'pricing'), timestamp: 11 }]);
    expect(results).toEqual([
      { identifier: { identifierType: 'ISIN', identifierValue: 'US0000000001' }, dataType: 'assetHeader', status: 'accepted' },
      { identifier: { identifierType: 'ISIN', identifierValue: 'US0000000002' }, dataType: 'pricing', status: 'rejected', reason: 'bad price' },
    ]);
    expect(posted).toEqual([{ path: '/data/assets/ingest', body: { source: 'ownera:dtcc', assets: [
      { identifier: { identifierType: 'ISIN', identifierValue: 'US0000000001' }, data: [{ dataType: 'assetHeader', data: header('US0000000001'), source: 'ownera:dtcc', timestamp: 10 }] },
      { identifier: { identifierType: 'ISIN', identifierValue: 'US0000000002' }, data: [{ dataType: 'pricing', data: header('x'), source: 'ownera:dtcc', timestamp: 11 }] },
    ] } }]);
  });

  it('throws when the router does not take the batch', async () => {
    const { ingest } = clientOf({ error: { errors: [{ code: 400, message: 'invalid' }] }, status: 400 });
    const refused = await ingest('ownera:dtcc', [{ item: item('US0000000001'), timestamp: 1 }]).catch((e) => e);
    expect(refused).toBeInstanceOf(IngestRefused);
    expect(refused.message).toMatch(/HTTP 400/);
    expect(refused.final).toBe(true);
  });

  it('tells a refusal that would repeat from one worth sending again', () => {
    expect([400, 401, 403, 404, 413, 422].map((s) => new IngestRefused(s, '').final)).toEqual([true, true, true, true, true, true]);
    expect([408, 429, 500, 502, 503, 504].map((s) => new IngestRefused(s, '').final)).toEqual([false, false, false, false, false, false]);
  });
});

describe('a call that must answer in time', () => {
  it('gives the answer, or fails once the time is up', async () => {
    expect(await withTimeout(Promise.resolve('ok'), 1_000, 'the router')).toBe('ok');
    await expect(withTimeout(new Promise(() => undefined), 10, 'the router')).rejects.toThrow('the router did not answer within 0s');
    await expect(withTimeout(Promise.reject(new Error('refused')), 1_000, 'the router')).rejects.toThrow('refused');
  });
});

describe('the feed\'s settings', () => {
  const { logger } = logs();

  it('is off unless the deployment turns it on, hourly by default', () => {
    expect(feedSettings({})).toEqual({ enabled: false, intervalMs: 3_600_000 });
    expect(feedSettings({ DATA_FEED_ENABLED: 'true', DATA_FEED_INTERVAL_SECONDS: '300' })).toEqual({ enabled: true, intervalMs: 300_000 });
    expect(feedPublisherFromEnv({}, {} as never, logger)).toBeUndefined();
  });

  it('refuses a switch that is neither true nor false, and an interval under a minute', () => {
    expect(() => feedSettings({ DATA_FEED_ENABLED: 'yes' })).toThrow(/expected true or false/);
    expect(() => feedSettings({ DATA_FEED_INTERVAL_SECONDS: '5' })).toThrow(/60 or more/);
  });

  it('publishes nothing without a router to write to', () => {
    expect(feedPublisherFromEnv({ DATA_FEED_ENABLED: 'true' }, undefined, logger)).toBeUndefined();
    expect(feedPublisherFromEnv({ DATA_FEED_ENABLED: 'true' }, {} as never, logger)).toBeInstanceOf(FeedPublisher);
  });

  it('logs a warning through `warning` when the logger has no `warn`, as the skeleton\'s own does', () => {
    const lines: string[] = [];
    const syslog = { info: () => undefined, error: () => undefined, warning: (m: string) => { lines.push(m); } };
    feedPublisherFromEnv({ DATA_FEED_ENABLED: 'true' }, undefined, syslog);
    expect(lines).toEqual([expect.stringMatching(/no router client/)]);
  });
});

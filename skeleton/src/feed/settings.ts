import type { FinP2PClient } from '@owneraio/finp2p-client';
import { routerIngest } from './ingest';
import { FeedMarkers, InMemoryFeedMarkers } from './markers';
import { FeedLogger, FeedPublisher } from './publisher';

export const DEFAULT_FEED_INTERVAL_MS = 60 * 60 * 1000;

/** The feed's settings, from the deployment's environment. Off unless `DATA_FEED_ENABLED` is true. */
export function feedSettings(env: NodeJS.ProcessEnv): { enabled: boolean; intervalMs: number } {
  const raw = env.DATA_FEED_ENABLED?.trim();
  if (raw && raw !== 'true' && raw !== 'false') throw new Error(`DATA_FEED_ENABLED is '${raw}': expected true or false`);
  const seconds = env.DATA_FEED_INTERVAL_SECONDS?.trim();
  const intervalMs = seconds ? Number(seconds) * 1000 : DEFAULT_FEED_INTERVAL_MS;
  if (!Number.isFinite(intervalMs) || intervalMs < 60_000) throw new Error(`DATA_FEED_INTERVAL_SECONDS is '${seconds}': expected a number of seconds, 60 or more`);
  return { enabled: raw === 'true', intervalMs };
}

/**
 * The publisher the deployment asked for, or none: it needs
 * `DATA_FEED_ENABLED=true` and a router client to write to.
 */
export function feedPublisherFromEnv(
  env: NodeJS.ProcessEnv,
  client: Pick<FinP2PClient, 'finAPIClient'> | undefined,
  logger: FeedLogger,
  markers: FeedMarkers = new InMemoryFeedMarkers(),
): FeedPublisher | undefined {
  const { enabled, intervalMs } = feedSettings(env);
  if (!enabled) return undefined;
  if (!client) {
    (logger.warn ?? logger.warning ?? logger.info).call(logger, 'data feed: DATA_FEED_ENABLED is true but there is no router client to publish to');
    return undefined;
  }
  return new FeedPublisher(routerIngest(client), markers, logger, { intervalMs });
}

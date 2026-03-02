import { LedgerAPIClient } from '../api/api';

/**
 * Represents a FinP2P network of multiple adapter nodes.
 * Each node belongs to an organization and exposes a LedgerAPIClient.
 *
 * Used by planSuite to route plan instructions to the correct adapter
 * based on the instruction's organizations field.
 */
export class FinP2PNetwork {
  private nodes = new Map<string, LedgerAPIClient>();

  /**
   * Register an adapter node for the given organization.
   */
  addNode(orgId: string, client: LedgerAPIClient): this {
    this.nodes.set(orgId, client);
    return this;
  }

  /**
   * Get the LedgerAPIClient for a specific organization.
   */
  getClient(orgId: string): LedgerAPIClient {
    const client = this.nodes.get(orgId);
    if (!client) {
      const known = [...this.nodes.keys()].join(', ');
      throw new Error(
        `No adapter node registered for organization "${orgId}". ` +
        `Known organizations: [${known}]`,
      );
    }
    return client;
  }

  /**
   * Returns any available client (for operations like createAsset
   * that don't depend on org routing).
   */
  anyClient(): LedgerAPIClient {
    const first = this.nodes.values().next();
    if (first.done) throw new Error('FinP2PNetwork has no registered nodes');
    return first.value;
  }

  /** All registered organization IDs. */
  get organizations(): string[] {
    return [...this.nodes.keys()];
  }
}

import { randomUUID } from 'crypto';
import {
  AccountOperation,
  BindInfo,
  failedAccountOperation,
  NetworkAccountService,
  NetworkAccountValidator,
  NotSupportedError,
  successfulAccountOperation,
} from '../../models';
import { NetworkAccountStore } from '../../storage';
import { PluginManager } from '../../plugins';
import { logger } from '../../helpers';

/**
 * Sync trust-model implementation of investor account onboarding: the
 * caller-supplied wallet is recorded as-is, without an ownership challenge —
 * the same trust the old finId->wallet mapping API extended. Both methods are
 * single-call and terminal, so instances may be wrapped in the workflow
 * `createServiceProxy` like any other service.
 *
 * Pass a `PluginManager` carrying an `AccountClaimPlugin` to replace that trust
 * with a link checked against an external authority. Without one the behaviour
 * is exactly as it was.
 *
 * One binding per investor per (organizationId, assetId): a repeat create for
 * the same finId replays the recorded binding — even with a different wallet
 * in the request; changing wallets is remove + create. Replay-by-finId also
 * keeps crash-recovery replays from minting duplicates. Different investors
 * may still bind the same address (omnibus: one shared wallet, many investors).
 */
export class NetworkAccountServiceImpl implements NetworkAccountService {

  constructor(
    protected readonly store: NetworkAccountStore,
    protected readonly validator?: NetworkAccountValidator,
    protected readonly pluginManager?: PluginManager,
  ) {
  }

  async createAccount(idempotencyKey: string, organizationId: string, assetId: string,
    finId: string, bindInfo: BindInfo | undefined): Promise<AccountOperation> {
    if (!bindInfo) {
      throw new NotSupportedError('create-new account mode is not supported by this adapter');
    }
    const { account } = bindInfo;
    await this.validator?.validate(account);

    // Claim runs after validation, so a malformed address is rejected locally
    // and never costs a remote round trip. It runs unconditionally: there is no
    // read-before-insert to tell a first create from a repeat, and adding one
    // would reintroduce the race that insert()-returns-existing avoids. A claim
    // is therefore required to be idempotent and to answer `linked` for an
    // account it has already linked.
    const claimPlugin = this.pluginManager?.getAccountClaimPlugin();
    if (claimPlugin) {
      const claim = await claimPlugin.claim(organizationId, assetId, finId, account);
      switch (claim.type) {
        case 'linked':
          break;
        case 'refused':
          // Nothing is stored, and on a repeat create nothing is removed
          // either: a refusal never deletes a binding the store already holds.
          // Unbinding is DELETE /accounts/{accountId} and nothing else.
          logger.info('Account claim refused', { organizationId, assetId, finId, reason: claim.reason, code: claim.code });
          return failedAccountOperation('', claim.code, claim.message);
        case 'pending':
        case 'challenge':
          // Phase 2. Both need a callback that reports progress without
          // completing the operation, and the workflow proxy sends exactly one
          // terminal callback today. Failing is the honest answer: storing the
          // binding would record an account nobody has proven is the
          // investor's, which is the single thing the claim exists to prevent.
          logger.warning('Account claim returned a phase 2 result; failing the operation', {
            organizationId, assetId, finId, claimType: claim.type,
          });
          return failedAccountOperation('', 1,
            `Account claim returned '${claim.type}', which this adapter does not support yet: `
            + 'deferred and challenge-based claims arrive in phase 2. '
            + 'A phase 1 claim plugin must answer \'linked\' or \'refused\'.');
      }
    }

    // insert() is atomic and returns the pre-existing row when one is already
    // bound for this (organization, asset, finId), which is what makes a repeat
    // create replay the recorded binding rather than race or duplicate it.
    const row = await this.store.insert({
      accountId: randomUUID(),
      idempotencyKey: idempotencyKey || undefined,
      organizationId, assetId, finId, account,
    });
    return successfulAccountOperation('', { id: row.accountId, account: row.account });
  }

  async removeAccount(_idempotencyKey: string, accountId: string): Promise<AccountOperation> {
    const removed = await this.store.remove(accountId);
    // idempotent: an absent row is a success so router retries don't fail
    return successfulAccountOperation('', {
      id: accountId,
      account: removed?.account ?? { type: 'none' },
    });
  }
}

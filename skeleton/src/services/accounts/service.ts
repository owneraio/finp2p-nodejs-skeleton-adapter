import { randomUUID } from 'crypto';
import {
  AccountOperation,
  BindInfo,
  NetworkAccountService,
  NetworkAccountValidator,
  NotSupportedError,
  successfulAccountOperation,
} from '../../models';
import { NetworkAccountStore } from '../../storage';

/**
 * Sync trust-model implementation of investor account onboarding: the
 * caller-supplied wallet is recorded as-is, without an ownership challenge —
 * the same trust the old finId->wallet mapping API extended. Both methods are
 * single-call and terminal, so instances may be wrapped in the workflow
 * `createServiceProxy` like any other service.
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
  ) {
  }

  async createAccount(idempotencyKey: string, organizationId: string, assetId: string,
    finId: string, bindInfo: BindInfo | undefined): Promise<AccountOperation> {
    if (!bindInfo) {
      throw new NotSupportedError('create-new account mode is not supported by this adapter');
    }
    const { account } = bindInfo;
    await this.validator?.validate(account);

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

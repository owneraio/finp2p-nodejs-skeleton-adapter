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
 * Every create with a fresh idempotency key records a NEW binding with its own
 * account id — even for an address that already has bindings (omnibus: one
 * shared wallet, many investors). A re-sent request (same idempotency key)
 * replays the recorded binding, which also keeps crash-recovery replays from
 * minting duplicates.
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

    if (idempotencyKey) {
      const existing = await this.store.getByIdempotencyKey(idempotencyKey);
      if (existing) {
        return successfulAccountOperation('', { id: existing.accountId, account: existing.account });
      }
    }

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

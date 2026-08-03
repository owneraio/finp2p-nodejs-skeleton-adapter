import {
  AccountOperation,
  BindInfo,
  NetworkAccountService,
  NotSupportedError,
} from '../../models';

/**
 * Pass to `register()` when the adapter has no network-account support: every
 * account endpoint answers 501 (mirroring the vanilla Go adapter's
 * notImplemented).
 */
export class NotSupportedNetworkAccountService implements NetworkAccountService {

  createAccount(_idempotencyKey: string, _organizationId: string, _assetId: string,
    _finId: string | undefined, _bindInfo: BindInfo | undefined): Promise<AccountOperation> {
    throw new NotSupportedError('network accounts are not supported by this adapter');
  }

  removeAccount(_idempotencyKey: string, _accountId: string): Promise<AccountOperation> {
    throw new NotSupportedError('network accounts are not supported by this adapter');
  }
}

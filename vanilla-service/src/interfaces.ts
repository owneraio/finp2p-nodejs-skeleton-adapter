import {
  Asset, Destination, ExecutionContext, Source,
} from '@owneraio/finp2p-adapter-models';

/**
 * Delegate interface for operations that require external/on-chain interaction.
 * Adapter developers implement this when opting into the vanilla DB ledger.
 */
export interface ExternalTransferDelegate {
  /**
   * Called when release/transfer targets an external destination (crypto/IBAN).
   * Internal DB bookkeeping (unlock/debit) is already done.
   */
  executeExternalTransfer(
    idempotencyKey: string,
    source: Source,
    destination: Destination,
    asset: Asset,
    quantity: string,
    exCtx: ExecutionContext | undefined,
  ): Promise<{ transactionId: string }>;
}

import {
  Asset, AssetBind, Destination, ExecutionContext,
  LedgerReference, OperationType, Receipt, Source,
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

  /**
   * Optional: called on createAsset for ledger-specific setup (e.g. deploy smart contract).
   */
  onAssetCreated?(
    idempotencyKey: string,
    asset: Asset,
    assetBind: AssetBind | undefined,
    assetMetadata: any | undefined,
  ): Promise<{ tokenId: string; reference: LedgerReference | undefined }>;

  /**
   * Optional: custom receipt/proof generation.
   * If not provided, a basic receipt is built from the transaction record.
   */
  generateReceipt?(
    asset: Asset,
    source: Source | undefined,
    destination: Destination | undefined,
    quantity: string,
    operationType: OperationType,
    transactionId: string,
    exCtx: ExecutionContext | undefined,
    operationId: string | undefined,
  ): Promise<Receipt>;
}

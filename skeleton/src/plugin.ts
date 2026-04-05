/**
 * Lightweight entry point for plugin implementors.
 *
 * Exports only plugin interfaces and the domain types they reference.
 * Use: import type { PlanApprovalPlugin, Asset } from '@owneraio/finp2p-nodejs-skeleton-adapter/plugin'
 */
export {
  // Plugin interfaces
  AssetCreationPlugin,
  AsyncAssetCreationPlugin,
  PlanApprovalPlugin,
  AsyncPlanApprovalPlugin,
  PaymentsPlugin,
  AsyncPaymentsPlugin,
  TransactionHook,
  TransactionType,
  LedgerCallbackService,
  InstructionResult,
  PlannedInboundTransferContext,
  InboundTransferContext,
  InboundTransferHook,
  Plugin,
  PluginError,
} from './models/plugins';

export {
  // Domain types used by plugin method signatures
  Account,
  Asset,
  DepositAsset,
  DepositOperation,
  Destination,
  DestinationAccount,
  ExecutionContext,
  FinIdAccount,
  OperationStatus,
  PlanApprovalStatus,
  ReceiptOperation,
  Signature,
  Source,
} from './models/model';

/**
 * Lightweight entry point for plugin implementors.
 *
 * Use: import type { PlanApprovalPlugin, Asset } from '@owneraio/finp2p-nodejs-skeleton-adapter/plugin'
 *
 * Plugins are always synchronous — return the result directly (via Promise).
 * The skeleton's workflow proxy handles async delivery (DB persistence, router callbacks).
 */
export {
  // Plugin interfaces
  AssetCreationPlugin,
  PlanApprovalPlugin,
  PaymentsPlugin,
  LedgerCallbackService,
  InstructionResult,
  PlannedInboundTransferContext,
  InboundTransferContext,
  InboundTransferHook,
  PlanAnalyzer,
  PluginError,
} from './models/plugins';

export {
  // Domain types used by plugin method signatures
  Asset,
  DepositAsset,
  DepositOperation,
  Destination,
  ExecutionContext,
  OperationStatus,
  PlanApprovalStatus,
  ExecutionPlan,
  ReceiptOperation,
  Signature,
  Source,
} from './models/model';

export {
  BusinessError,
  ValidationError,
} from './models/errors';

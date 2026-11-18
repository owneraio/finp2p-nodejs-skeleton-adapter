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
  PluginLifecycle,
  AccountClaimPlugin,
  AccountClaimResult,
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
  AccountChallenge,
  Asset,
  DepositAsset,
  DepositOperation,
  Destination,
  ExecutionContext,
  OperationStatus,
  PlanApprovalStatus,
  ExecutionPlan,
  ReceiptOperation,
  NetworkAccount,
  Signature,
  Source,
} from './models/model';

export {
  Logger,
} from './models/logger';

export {
  BusinessError,
  ValidationError,
} from './models/errors';

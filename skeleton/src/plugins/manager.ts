import {
  AssetCreationPlugin,
  PaymentsPlugin,
  PlanAnalyzer,
  PlanApprovalPlugin,
  TransactionHook,
} from '../models';


export class PluginManager {

  private assetCreationPlugin: AssetCreationPlugin | null = null;

  private planApprovalPlugin: PlanApprovalPlugin | null = null;

  private paymentsPlugin: PaymentsPlugin | null = null;

  private transactionHook: TransactionHook | null = null;

  private planAnalyzer: PlanAnalyzer | null = null;

  registerAssetCreationPlugin(plugin: AssetCreationPlugin): void {
    this.assetCreationPlugin = plugin;
  }

  getAssetCreationPlugin(): AssetCreationPlugin | null {
    return this.assetCreationPlugin;
  }

  registerPlanApprovalPlugin(plugin: PlanApprovalPlugin): void {
    this.planApprovalPlugin = plugin;
  }

  getPlanApprovalPlugin(): PlanApprovalPlugin | null {
    return this.planApprovalPlugin;
  }

  registerPaymentsPlugin(plugin: PaymentsPlugin): void {
    this.paymentsPlugin = plugin;
  }

  getPaymentsPlugin(): PaymentsPlugin | null {
    return this.paymentsPlugin;
  }

  registerTransactionHook(plugin: TransactionHook): void {
    this.transactionHook = plugin;
  }

  getTransactionHook(): TransactionHook | null {
    return this.transactionHook;
  }

  registerPlanAnalyzer(analyzer: PlanAnalyzer): void {
    this.planAnalyzer = analyzer;
  }

  getPlanAnalyzer(): PlanAnalyzer | null {
    return this.planAnalyzer;
  }

}

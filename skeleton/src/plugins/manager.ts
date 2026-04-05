import {
  AssetCreationPlugin,
  AsyncAssetCreationPlugin,
  AsyncPaymentsPlugin,
  AsyncPlanApprovalPlugin,
  PaymentsPlugin,
  PlanAnalyzer,
  PlanApprovalPlugin,
  TransactionHook,
  Plugin,
} from '../models';


export class PluginManager {

  private assetCreationPlugin: Plugin<AssetCreationPlugin, AsyncAssetCreationPlugin> | null = null;

  private planApprovalPlugin: Plugin<PlanApprovalPlugin, AsyncPlanApprovalPlugin> | null = null;

  private paymentsPlugin: Plugin<PaymentsPlugin, AsyncPaymentsPlugin> | null = null;

  private transactionHook: TransactionHook | null = null;

  private planAnalyzer: PlanAnalyzer | null = null;

  registerPlanAnalyzer(analyzer: PlanAnalyzer): void {
    this.planAnalyzer = analyzer;
  }

  getPlanAnalyzer(): PlanAnalyzer | null {
    return this.planAnalyzer;
  }

  registerAssetCreationPlugin(plugin: Plugin<AssetCreationPlugin, AsyncAssetCreationPlugin>): void {
    this.assetCreationPlugin = plugin;
  }

  getAssetCreationPlugin(): Plugin<AssetCreationPlugin, AsyncAssetCreationPlugin> | null {
    return this.assetCreationPlugin;
  }

  registerPlanApprovalPlugin(plugin: Plugin<PlanApprovalPlugin, AsyncPlanApprovalPlugin>): void {
    this.planApprovalPlugin = plugin;
  }

  getPlanApprovalPlugin(): Plugin<PlanApprovalPlugin, AsyncPlanApprovalPlugin> | null {
    return this.planApprovalPlugin;
  }


  registerPaymentsPlugin(plugin: Plugin<PaymentsPlugin, AsyncPaymentsPlugin>): void {
    this.paymentsPlugin = plugin;
  }

  getPaymentsPlugin(): Plugin<PaymentsPlugin, AsyncPaymentsPlugin> | null {
    return this.paymentsPlugin;
  }


  registerTransactionHook(plugin: TransactionHook): void {
    this.transactionHook = plugin;
  }

  getTransactionHook(): TransactionHook | null {
    return this.transactionHook;
  }

}

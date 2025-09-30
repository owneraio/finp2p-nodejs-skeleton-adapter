import {
  AssetCreationPlugin,
  AsyncAssetCreationPlugin,
  AsyncPaymentsPlugin,
  AsyncPlanApprovalPlugin, PaymentsPlugin,
  PlanApprovalPlugin, TransactionHook,
} from './interfaces';
import { Plugin } from './plugin';


export class PluginManager {

  private assetCreationPlugin: Plugin<AssetCreationPlugin, AsyncAssetCreationPlugin> | null = null;

  private planApprovalPlugin: Plugin<PlanApprovalPlugin, AsyncPlanApprovalPlugin> | null = null;

  private paymentsPlugin: Plugin<PaymentsPlugin, AsyncPaymentsPlugin> | null = null;

  private transactionHook: TransactionHook | null = null;

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

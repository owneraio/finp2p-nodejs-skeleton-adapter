import {AssetCreationPlugin, DepositPlugin, PlanApprovalPlugin} from "./interfaces";


export class PluginManager {

  private assetCreationPlugin: AssetCreationPlugin | null = null;
  private planApprovalPlugin: PlanApprovalPlugin | null = null;
  private depositPlugin: DepositPlugin | null = null;

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

  registerDepositPlugin(plugin: DepositPlugin): void {
    this.depositPlugin = plugin;
  }

  getDepositPlugin(): DepositPlugin | null {
    return this.depositPlugin;
  }

}

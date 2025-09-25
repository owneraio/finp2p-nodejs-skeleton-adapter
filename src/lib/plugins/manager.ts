import {AsyncPaymentsPlugin, AsyncPlanApprovalPlugin, PlanApprovalPlugin} from "./interfaces";
import {Plugin} from "./plugin";


export class PluginManager {

  private planApprovalPlugin: Plugin<PlanApprovalPlugin, AsyncPlanApprovalPlugin> | null = null;
  private depositPlugin: AsyncPaymentsPlugin | null = null;


  registerPlanApprovalPlugin(plugin: Plugin<PlanApprovalPlugin, AsyncPlanApprovalPlugin>): void {
    this.planApprovalPlugin = plugin;
  }

  getPlanApprovalPlugin(): Plugin<PlanApprovalPlugin, AsyncPlanApprovalPlugin> | null {
    return this.planApprovalPlugin;
  }

  registerDepositPlugin(plugin: AsyncPaymentsPlugin): void {
    this.depositPlugin = plugin;
  }

  getDepositPlugin(): AsyncPaymentsPlugin | null {
    return this.depositPlugin;
  }

}

import {
  AccountClaimPlugin,
  AssetCreationPlugin,
  Logger,
  PaymentsPlugin,
  PlanAnalyzer,
  PlanApprovalPlugin,
  PluginLifecycle,
} from '../models';

/** A plugin that may or may not take part in the startup hook. */
const hasInit = (plugin: unknown): plugin is PluginLifecycle =>
  typeof (plugin as PluginLifecycle | null)?.init === 'function';


export class PluginManager {

  private assetCreationPlugin: AssetCreationPlugin | null = null;

  private planApprovalPlugin: PlanApprovalPlugin | null = null;

  private paymentsPlugin: PaymentsPlugin | null = null;

  private planAnalyzer: PlanAnalyzer | null = null;

  private accountClaimPlugin: AccountClaimPlugin | null = null;

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

  registerPlanAnalyzer(analyzer: PlanAnalyzer): void {
    this.planAnalyzer = analyzer;
  }

  getPlanAnalyzer(): PlanAnalyzer | null {
    return this.planAnalyzer;
  }

  registerAccountClaimPlugin(plugin: AccountClaimPlugin): void {
    this.accountClaimPlugin = plugin;
  }

  getAccountClaimPlugin(): AccountClaimPlugin | null {
    return this.accountClaimPlugin;
  }

  /**
   * Run every registered plugin's `init`, in registration order, and reject on
   * the first throw. Called once; the skeleton never retries.
   *
   * **The adapter must await this before it starts listening.** The skeleton
   * cannot do it for you: `register()` is handed an Express app that is already
   * built and never sees this manager, so there is no point inside the skeleton
   * where it owns startup. Forget the await and a plugin that needs a session
   * will serve requests without one.
   *
   *     const pluginManager = new PluginManager();
   *     pluginManager.registerAccountClaimPlugin(new MyClaimPlugin());
   *     await pluginManager.init(logger);   // a throw here must stop startup
   *     app.listen(port);
   */
  async init(logger: Logger): Promise<void> {
    const plugins: [string, unknown][] = [
      ['assetCreation', this.assetCreationPlugin],
      ['planApproval', this.planApprovalPlugin],
      ['payments', this.paymentsPlugin],
      ['planAnalyzer', this.planAnalyzer],
      ['accountClaim', this.accountClaimPlugin],
    ];
    for (const [name, plugin] of plugins) {
      if (!hasInit(plugin)) continue;
      logger.info('Initializing plugin', { plugin: name });
      await plugin.init(logger);
    }
  }

}

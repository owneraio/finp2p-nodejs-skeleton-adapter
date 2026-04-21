import createClient, { Client, Middleware } from 'openapi-fetch';
import { components as FinAPIComponents, paths as FinAPIPaths } from './model-gen';
import { components as OpComponents, paths as OpPaths } from './op-model-gen';
import { sleep } from './utils';

// Helper: extract the request body type for a given path + method from openapi-fetch paths
type RequestBody<P extends keyof FinAPIPaths, M extends keyof FinAPIPaths[P]> =
  FinAPIPaths[P][M] extends { requestBody: { content: { 'application/json': infer B } } } ? B : never;

type OpRequestBody<P extends keyof OpPaths, M extends keyof OpPaths[P]> =
  OpPaths[P][M] extends { requestBody: { content: { 'application/json': infer B } } } ? B : never;

export class FinAPIClient {

  finP2PUrl: string;

  authTokenResolver: (() => string) | undefined;

  apiClient: Client<FinAPIPaths>;

  opClient: Client<OpPaths>;

  constructor(finP2PUrl: string, authTokenResolver: (() => string) | undefined = undefined) {
    this.finP2PUrl = finP2PUrl;
    this.authTokenResolver = authTokenResolver;
    this.apiClient = createClient<FinAPIPaths>({ baseUrl: finP2PUrl });
    this.opClient = createClient<OpPaths>({ baseUrl: finP2PUrl });

    if (authTokenResolver) {
      const authMiddleware: Middleware = {
        onRequest({ request }) {
          try {
            const token = authTokenResolver();
            request.headers.set('Authorization', `Bearer ${token}`);
          } catch (error) {
            throw new Error(`Failed to resolve auth token: ${error instanceof Error ? error.message : error}`);
          }
          return request;
        },
      };
      this.apiClient.use(authMiddleware);
      this.opClient.use(authMiddleware);
    }
  }

  // ── Owner / Profile ──

  async createOwner() {
    return this.apiClient.POST('/profiles/owner');
  }

  async createAsset(name: string, type: FinAPIComponents['schemas']['assetType'], issuerId: string,
    symbol: string | undefined,
    denomination: FinAPIComponents['schemas']['assetDenomination'],
    intentTypes: FinAPIComponents['schemas']['intentType'][],
    ledgerAssetBinding: FinAPIComponents['schemas']['ledgerAssetBinding'],
    assetPolicies: FinAPIComponents['schemas']['assetPolicies'] | undefined,
    config: string | undefined,
    metadata: any | undefined,
    financialIdentifier: FinAPIComponents['schemas']['financialAssetIdentifier'] | undefined,
  ) {
    return this.apiClient.POST('/profiles/asset', {
      body: {
        intentTypes, name, type, symbol, issuerId, denomination,
        ledgerAssetBinding, assetPolicies, config, metadata, financialIdentifier,
      },
    });
  }

  async shareProfile(id: string, organizations: string[]) {
    return this.apiClient.POST('/profiles/{id}/share', {
      params: { path: { id } },
      body: { organizations },
    });
  }

  async createCertificate(profileId: string, type: string, data: string, issuanceDate: number, expirationDate: number) {
    return this.apiClient.POST('/profiles/{profileId}/certificates', {
      params: { path: { profileId } },
      body: {
        type, data, issuanceDate, expirationDate,
      },
    });
  }

  async updateCertificate(profileId: string, certificateId: string, body: { data?: string; expirationDate?: number }) {
    return this.apiClient.PATCH('/profiles/{profileId}/certificates/{certificateId}', {
      params: { path: { profileId, certificateId } },
      body,
    } as any);
  }

  // ── Account management ──

  async createOwnerAccount(ownerId: string, body: RequestBody<'/profiles/owner/{ownerId}/account', 'post'>) {
    return this.apiClient.POST('/profiles/owner/{ownerId}/account', {
      params: { path: { ownerId } },
      body,
    });
  }

  // ── Intent creation ──

  async createIntent(assetId: string, body: RequestBody<'/profiles/asset/{id}/intent', 'post'>) {
    return this.apiClient.POST('/profiles/asset/{id}/intent', {
      params: { path: { id: assetId } },
      body,
    });
  }

  // ── Intent execution ──

  async executeIntent(body: RequestBody<'/tokens/execute', 'post'>) {
    return this.apiClient.POST('/tokens/execute', { body });
  }

  async cancelExecution(body: RequestBody<'/tokens/execute/cancel', 'post'>) {
    return this.apiClient.POST('/tokens/execute/cancel', { body });
  }

  async resetExecution(body: RequestBody<'/tokens/execute/reset', 'post'>) {
    return this.apiClient.POST('/tokens/execute/reset', { body });
  }

  // ── Deposit ──

  async createDeposit(body: RequestBody<'/payments/deposit', 'post'>) {
    return this.apiClient.POST('/payments/deposit', { body });
  }

  // ── Balance sync ──

  async syncBalance(body: RequestBody<'/profiles/owner/account/balance/sync', 'post'>) {
    return this.apiClient.POST('/profiles/owner/account/balance/sync', { body });
  }

  // ── Operations ──

  async getOperationStatus(cid: string) {
    return this.apiClient.GET('/operations/status/{cid}', {
      params: { path: { cid } },
    });
  }

  async waitForOperationCompletion(cid: string, timeoutMs: number): Promise<FinAPIComponents['schemas']['operationResponse']> {
    const start = Date.now();
    while (true) {
      const { data: status } = await this.getOperationStatus(cid);
      if (status && status.isCompleted) {
        return status;
      }
      if (Date.now() - start > timeoutMs) {
        throw new Error(`Timeout waiting for operation ${cid} to complete`);
      }
      await sleep(1000);
    }
  }

  // ── Execution plan (operational API) ──

  async getExecutionPlan(planId: string) {
    return this.opClient.GET('/execution/{planId}', { params: { path: { planId } } });
  }

  // ── Ledger management (operational API) ──

  async bindLedger(body: OpRequestBody<'/ledger/bind', 'post'>) {
    return this.opClient.POST('/ledger/bind', { body });
  }

  async updateLedger(name: string, body: OpRequestBody<'/ledger/{name}/update', 'patch'>) {
    return this.opClient.PATCH('/ledger/{name}/update', {
      params: { path: { name } },
      body,
    });
  }

  // ── Custody provider management (operational API) ──

  async bindCustodyProvider(body: OpRequestBody<'/custody/bind', 'post'>) {
    return this.opClient.POST('/custody/bind', { body });
  }

  async updateCustodyProvider(name: string, body: OpRequestBody<'/custody/{name}/update', 'patch'>) {
    return this.opClient.PATCH('/custody/{name}/update', {
      params: { path: { name } },
      body,
    });
  }

  // ── Approval routing (operational API) ──

  async setApprovalRouting(body: OpRequestBody<'/execution/proposals', 'put'>) {
    return this.opClient.PUT('/execution/proposals', { body });
  }

  async updateApprovalRouting(body: OpRequestBody<'/execution/proposals', 'patch'>) {
    return this.opClient.PATCH('/execution/proposals', { body });
  }

  // ── Transactions (operational API) ──

  async importTransactions(transactions: OpComponents['schemas']['transaction'][]) {
    return this.opClient.POST('/ledger/transaction/import', {
      body: { transactions },
    });
  }

  async sendCallback(cid: string, operationStatus: OpComponents['schemas']['operationStatus']) {
    return this.opClient.POST('/operations/callback/{cid}', {
      params: { path: { cid } },
      body: { ...operationStatus },
    });
  }

  // ── Policies (operational API) ──

  async getPolicy(policyId: string) {
    return this.opClient.GET('/policies/{policyId}', { params: { path: { policyId } } });
  }

  async getAssetPolicies(assetId: string) {
    return this.opClient.GET('/assets/{assetId}/policies', { params: { path: { assetId } } });
  }

  async createPolicy(body: OpRequestBody<'/policies/create', 'post'>) {
    return this.opClient.POST('/policies/create', { body });
  }

  async updatePolicy(body: OpRequestBody<'/policies/update', 'post'>) {
    return this.opClient.POST('/policies/update', { body });
  }

  async deletePolicy(policyId: string) {
    return this.opClient.DELETE('/policies/delete/{policyId}', { params: { path: { policyId } } });
  }

}

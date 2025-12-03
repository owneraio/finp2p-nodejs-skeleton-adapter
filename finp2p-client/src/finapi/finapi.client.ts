import createClient, { Client } from 'openapi-fetch';
import { components as FinAPIComponents, paths as FinAPIPaths } from './model-gen';
import { components as OpComponents, paths as OpPaths } from './op-model-gen';
import { sleep } from './utils';

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
  }

  async createOwner() {
    return this.apiClient.POST('/profiles/owner');
  }

  async createAsset(name: string, type: string, issuerId: string,
    symbol: string | undefined,
    denomination: FinAPIComponents['schemas']['assetDenomination'],
    intentTypes: FinAPIComponents['schemas']['intentType'][],
    ledgerAssetBinding: FinAPIComponents['schemas']['ledgerAssetBinding'] | undefined,
    assetPolicies: FinAPIComponents['schemas']['assetPolicies'] | undefined,
    config: string | undefined,
    metadata: any | undefined,
    assetIdentifier: FinAPIComponents['schemas']['assetIdentifier'] | undefined,
  ) {
    return this.apiClient.POST('/profiles/asset', {
      body: {
        intentTypes, name, type, symbol, issuerId, denomination,
        ledgerAssetBinding, assetPolicies, config, metadata, assetIdentifier,
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

  async getOperationalExecutionPlan(planId: string) {
    return this.opClient.GET('/execution/{planId}', { params: { path: { planId } } });
  }

}

import process from "process";
import {OssClient, parseProofDomain, Proof, ProofDomain, ProofPolicy} from "./oss";
import {FinAPIClient} from "./finapi";
import {components as FinAPIComponents, paths as FinAPIPaths} from "./finapi/model-gen";
import {components as OpComponents, paths as OpPaths} from "./finapi/op-model-gen";


export class FinP2PClient {

  finAPIClient: FinAPIClient;
  ossClient: OssClient;

  constructor(finAPIUrl: string, ossUrl: string) {
    this.finAPIClient = new FinAPIClient(finAPIUrl);
    this.ossClient = new OssClient(ossUrl);
  }

  async createAsset(name: string, type: string, issuerId: string,
                    symbol: string | undefined,
                    denomination: FinAPIComponents["schemas"]["assetDenomination"],
                    intentTypes: FinAPIComponents["schemas"]["intentType"][],
                    ledgerAssetBinding: FinAPIComponents["schemas"]["ledgerAssetBinding"] | undefined,
                    assetPolicies: FinAPIComponents["schemas"]["assetPolicies"] | undefined,
                    config: string | undefined,
                    metadata: any | undefined,
                    assetIdentifier: FinAPIComponents["schemas"]["assetIdentifier"] | undefined) {
    return await this.finAPIClient.createAsset(
      name, type, issuerId, symbol, denomination, intentTypes,
      ledgerAssetBinding, assetPolicies, config, metadata, assetIdentifier
    );
  }

  async shareProfile(id: string, organizations: string[]) {
    return await this.finAPIClient.shareProfile(id, organizations);
  }

  async createCertificate(profileId: string, type: string, data: string, issuanceDate: number, expirationDate: number) {
    return await this.finAPIClient.createCertificate(profileId, type, data, issuanceDate, expirationDate);
  }

  async getOperationStatus(id: string) {
    return await this.finAPIClient.getOperationStatus(id);
  }

  async sendCallback(cid: string, operationStatus: OpComponents["schemas"]["operationStatus"]) {
    return await this.finAPIClient.sendCallback(cid, operationStatus);
  }

  async importTransactions(transactions: OpComponents["schemas"]["transaction"][]) {
    return await this.finAPIClient.importTransactions(transactions);
  }

  async getExecutionPlan(planId: string) {
    return await this.finAPIClient.getExecutionPlan(planId);
  }

  // ------ OSS Client methods ------

  async getAssetProofPolicy(assetCode: string, assetType: string): Promise<ProofPolicy> {
    let proof: Proof;
    let domain: ProofDomain | null = null;
    let configRaw: string;
    switch (assetType) {
      case 'finp2p': {
        ({policies: {proof}, config: configRaw} = await this.getAsset(assetCode));
        domain = parseProofDomain(configRaw);
        break;
      }
      case 'cryptocurrency':
      case 'fiat': {
        const orgId = process.env.ORGANIZATION_ID || '';
        const paymentAsset = await this.getPaymentAsset(orgId, assetCode);
        if (paymentAsset) {
          ({policies: {proof}} = paymentAsset);
        } else {
          return {type: 'NoProofPolicy'};
        }
        break;
      }
      default:
        throw new Error(`Unknown asset type: ${assetType}`);
    }

    switch (proof.type) {
      case 'NoProofPolicy':
        return {type: 'NoProofPolicy'};
      case 'SignatureProofPolicy': {
        return {...proof, domain};
      }
    }
  }

  async getAsset(assetId: string) {
    return await this.ossClient.getAsset(assetId);
  }

  async getPaymentAsset(orgId: string, assetCode: string) {
    return await this.ossClient.getPaymentAsset(orgId, assetCode);
  }

  async getAssetsWithTokens() {
    return await this.ossClient.getAssetsWithTokens()
  }

  async getOwnerByFinId(assetId: string) {
    return await this.ossClient.getOwnerByFinId(assetId);
  }

  async getOwnerBalances(assetId: string) {
    return await this.ossClient.getOwnerBalances(assetId);
  }

}

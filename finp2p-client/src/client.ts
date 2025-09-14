import process from "process";
import {OssClient, parseProofDomain, Proof, ProofDomain, ProofPolicy} from "./oss";
import {FinAPIClient} from "./finapi";
import IntentType = FinAPIComponents.Schemas.IntentType;


export class FinP2PClient {

  finAPIClient: FinAPIClient;
  ossClient: OssClient;

  constructor(finAPIUrl: string, ossUrl: string) {
    this.finAPIClient = new FinAPIClient(finAPIUrl);
    this.ossClient = new OssClient(ossUrl);
  }

  async createAsset(name: string, type: string, issuerId: string, currency: string, currencyType: 'fiat' | 'cryptocurrency', intentTypes: IntentType[], metadata: any) {
    return await this.finAPIClient.createAsset(name, type, issuerId, currency, currencyType, intentTypes, metadata);
  }

  async shareProfile(id: string, organizations: string[]) {
    return await this.finAPIClient.shareProfile(id, organizations);
  }

  async getProfileOperationStatus(id: string) {
    return await this.finAPIClient.getProfileOperationStatus(id);
  }

  // async sendCallback(cid: string, operationStatus: OperationStatus) {
  //   return await this.finAPIClient.sendCallback(cid, operationStatus);
  // }

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

  async getOwnerBalances(assetId: string) {
    return await this.ossClient.getOwnerBalances(assetId);
  }

}

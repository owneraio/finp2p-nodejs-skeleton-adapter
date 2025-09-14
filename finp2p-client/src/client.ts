import process from "process";
import {OssClient, parseProofDomain, Proof, ProofDomain, ProofPolicy} from "./oss";


export class FinP2PClient {

  ossClient: OssClient;

  constructor(baseUrl: string) {
    this.ossClient = new OssClient("", undefined);
  }

  async getPolicy(assetCode: string, assetType: string): Promise<ProofPolicy> {
    let proof: Proof;
    let domain: ProofDomain | null = null;
    let configRaw: string;
    switch (assetType) {
      case 'finp2p': {
        ({ policies: { proof }, config: configRaw } = await this.ossClient.getAsset(assetCode));
        domain = parseProofDomain(configRaw);
        break;
      }
      case 'cryptocurrency':
      case 'fiat': {
        const orgId = process.env.ORGANIZATION_ID || '';
        const paymentAsset = await this.ossClient.getPaymentAsset(orgId, assetCode);
        if (paymentAsset) {
          ({ policies: { proof } } = paymentAsset);
        } else {
          return { type: 'NoProofPolicy' };
        }
        break;
      }
      default:
        throw new Error(`Unknown asset type: ${assetType}`);
    }

    switch (proof.type) {
      case 'NoProofPolicy':
        return { type: 'NoProofPolicy' };
      case 'SignatureProofPolicy': {
        return { ...proof, domain };
      }
    }
  }

}

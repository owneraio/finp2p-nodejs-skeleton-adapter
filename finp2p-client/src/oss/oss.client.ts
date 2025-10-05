import 'graphql-import-node';
import * as axios from 'axios';
import {DocumentNode} from 'graphql';
import OWNERS from './graphql/owners.graphql';
import ORGANIZATIONS from './graphql/organization.graphql';
import ASSETS from './graphql/assets.graphql';
import PAYMENT_ASSETS from './graphql/payment-assets.graphql';
import {OssAssetNodes, OssEscrowNodes, OssOrganizationNodes, OssOwnerNodes} from './model';
import {ItemNotFoundError} from "./errors";

export class OssClient {

  ossUrl: string;

  authTokenResolver: (() => string) | undefined;

  constructor(ossUrl: string, authTokenResolver: (() => string) | undefined = undefined) {
    this.ossUrl = ossUrl;
    this.authTokenResolver = authTokenResolver;
  }

  async getOwnerBalances(assetId: string) {
    const resp = await this.queryOss<OssOwnerNodes>(OWNERS, {
      includeCerts: false,
      includeHoldings: true
    });
    return resp.users.nodes.filter((o) => o.holdings.nodes.some(n => n.asset.resourceId === assetId))
      .map(o => ({finId: o.finIds[0], balance: o.holdings.nodes.find(n => n.asset.resourceId === assetId)!.balance}));
  }

  async getOwnerById(ownerId: string) {
    const resp = await this.queryOss<OssOwnerNodes>(OWNERS, {
      filter: {
        key: 'id',
        operator: 'EQ',
        value: ownerId
      }, includeCerts: true, includeHoldings: false
    });
    if (resp.users.nodes.length == 0) {
      throw new ItemNotFoundError(ownerId, "Owner");
    }
    return resp.users.nodes[0];
  }

  async getOwnerByFinId(finId: string) {
    const resp = await this.queryOss<OssOwnerNodes>(OWNERS, {
      filter: {
        key: 'finIds',
        operator: 'CONTAINS',
        value: finId
      }, includeCerts: true, includeHoldings: false
    });
    if (resp.users.nodes.length == 0) {
      throw new ItemNotFoundError(finId, "Owner");
    }
    return resp.users.nodes[0];
  }

  async getAssets() {
    const resp = await this.queryOss<OssAssetNodes>(ASSETS, {});
    return resp.assets.nodes;
  }

  async getAsset(assetId: string) {
    const resp = await this.queryOss<OssAssetNodes>(ASSETS, {
      filter: {
        key: "id",
        operator: "EQ",
        value: assetId
      }
    });
    if (resp.assets.nodes.length == 0) {
      throw new ItemNotFoundError(assetId, "Asset");
    }
    return resp.assets.nodes[0];
  }

  async getPaymentAssets() {
    const resp = await this.queryOss<OssEscrowNodes>(PAYMENT_ASSETS, {});
    return resp.escrows.nodes.map(e => e.paymentAsset);
  }

  async getPaymentAsset(orgId: string, assetCode: string) {
    const resp = await this.queryOss<OssEscrowNodes>(PAYMENT_ASSETS, {
      filter: {
        key: "orgId",
        operator: "EQ",
        value: orgId
      }
    });
    if (resp.escrows.nodes.length == 0) {
      throw new ItemNotFoundError(`${orgId}`, "Payment asset");
    }

    const ast = resp.escrows.nodes[0].paymentAsset.assets.find(a => a.code === assetCode)
    if (!ast) {
      throw new ItemNotFoundError(`${orgId}:${assetCode}`, "Payment asset");
    }
    return ast;
  }

  async getOrganization(orgId: string) {
    const resp = await this.queryOss<OssOrganizationNodes>(ORGANIZATIONS, {orgId});
    if (resp.organizations.nodes.length == 0) {
      throw new ItemNotFoundError(orgId, "Organization");
    }
    return resp.organizations.nodes[0];
  }


  async queryOss<T>(queryDoc: DocumentNode, variables: Record<string, any>): Promise<T> {
    let headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    } as Record<string, string>;
    if (this.authTokenResolver) {
      headers.Authorization = `Bearer ${this.authTokenResolver()}`;
    }

    const response = await axios.default.post<GraphqlResponse<T>>(
      this.ossUrl,
      {
        query: queryDoc.loc?.source.body,
        variables,
      },
      {
        headers,
      });
    return response.data.data;
  }

}

type GraphqlResponse<T> = {
  data: T
};

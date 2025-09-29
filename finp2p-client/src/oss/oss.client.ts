import 'graphql-import-node';
import {DocumentNode} from 'graphql';
import GET_OWNERS from './graphql/owners.graphql';
import GET_ASSET from './graphql/asset.graphql';
import GET_ORGANIZATION from './graphql/organization.graphql';
import GET_ALL_ASSETS from './graphql/all-assets.graphql';
import GET_PAYMENT_ASSET from './graphql/paymentAsset.graphql';
import * as axios from 'axios';
import {AssetIdentifier, LedgerAssetInfo, OssAssetNodes, OssOrganizationNodes, OssOwnerNodes} from './model';
import {ItemNotFoundError} from "./errors";

export class OssClient {

  ossUrl: string;

  authTokenResolver: (() => string) | undefined;

  constructor(ossUrl: string, authTokenResolver: (() => string) | undefined = undefined) {
    this.ossUrl = ossUrl;
    this.authTokenResolver = authTokenResolver;
  }

  async getOwnerBalances(assetId: string) {
    const resp = await this.queryOss<OssOwnerNodes>(GET_OWNERS, {
      userFilter: undefined,
      includeCerts: false,
      includeHoldings: true
    });
    return resp.users.nodes.filter((o) => o.holdings.nodes.some(n => n.asset.resourceId === assetId))
      .map(o => ({finId: o.finIds[0], balance: o.holdings.nodes.find(n => n.asset.resourceId === assetId)!.balance}));
  }

  async getOwnerById(ownerId: string) {
    const resp = await this.queryOss<OssOwnerNodes>(GET_OWNERS, {
      userFilter: {
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
    const resp = await this.queryOss<OssOwnerNodes>(GET_OWNERS, {
      userFilter: {
        key: 'finIds',
        operator: 'CONTAINS',
        value: finId
      }, includeCerts: true, includeHoldings: false
    });
    if (resp.users.nodes.length > 0) {
      throw new ItemNotFoundError(finId, "Owner");
    }
    return resp.users.nodes[0];
  }

  async getAsset(assetId: string) {
    const resp = await this.queryOss<OssAssetNodes>(GET_ASSET, {assetId});
    if (resp.assets.nodes.length == 0) {
      throw new ItemNotFoundError(assetId, "Asset");
    }
    return resp.assets.nodes[0];
  }

  async getPaymentAsset(orgId: string, assetCode: string) {
    const resp = await this.queryOss<OssAssetNodes>(GET_PAYMENT_ASSET, {orgId});
    if (resp.assets.nodes.length == 0) {
      throw new ItemNotFoundError(`${orgId}: ${assetCode}`, "Payment asset");
    }
    return resp.assets.nodes[0];
  }

  async getOrganization(orgId: string) {
    const resp = await this.queryOss<OssOrganizationNodes>(GET_ORGANIZATION, {orgId});
    if (resp.organizations.nodes.length == 0) {
      throw new ItemNotFoundError(orgId, "Organization");
    }
    return resp.organizations.nodes[0];
  }

  async getAssetsWithTokens(): Promise<{
    assetId: string,
    ledgerAssetInfo: LedgerAssetInfo,
    identifier: AssetIdentifier
  }[]> {
    const resp = await this.queryOss<OssAssetNodes>(GET_ALL_ASSETS, {});
    return resp.assets.nodes.filter(a => a.ledgerAssetInfo.tokenId.length > 0).map(a => ({
      assetId: a.id,
      ledgerAssetInfo: a.ledgerAssetInfo,
      identifier: a.assetIdentifier
    }));
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

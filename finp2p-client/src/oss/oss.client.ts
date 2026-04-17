import 'graphql-import-node';
import * as axios from 'axios';
import { DocumentNode } from 'graphql';
import OWNERS from './graphql/owners.graphql';
import ORGANIZATIONS from './graphql/organization.graphql';
import ASSETS from './graphql/assets.graphql';
import PAYMENT_ASSETS from './graphql/payment-assets.graphql';
import LEDGERS from './graphql/ledgers.graphql';
import APPROVAL_CONFIGS from './graphql/approval-configs.graphql';
import PLANS from './graphql/plans.graphql';
import RECEIPTS from './graphql/receipts.graphql';
import { OssApprovalConfigNodes, OssAssetNodes, OssCertificate, OssEscrowNodes, OssExecutionPlan, OssExecutionPlanNodes, OssLedgerBindingNodes, OssOrganizationNodes, OssOwnerNodes, OssReceipt, OssReceiptNodes } from './model';
import { ItemNotFoundError } from './errors';

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
      includeHoldings: true,
    });
    return resp.users.nodes.filter((o) => o.holdings.nodes.some(n => n.asset.resourceId === assetId))
      .map(o => ({ finId: o.finIds[0], balance: o.holdings.nodes.find(n => n.asset.resourceId === assetId)!.balance }));
  }

  async getSyncedBalances(assetId: string) {
    const resp = await this.queryOss<OssOwnerNodes>(OWNERS, {
      includeCerts: false,
      includeHoldings: true,
    });
    return resp.users.nodes.filter((o) => o.holdings.nodes.some(n => n.asset.resourceId === assetId))
      .map(o => ({ finId: o.finIds[0], balance: o.holdings.nodes.find(n => n.asset.resourceId === assetId)!.syncedBalance }));
  }

  async getOwnerSyncedBalance(ownerId: string, assetId: string): Promise<string> {
    const holdings = await this.getOwnerHoldings(ownerId);
    const holding = holdings.find(h => h.asset.resourceId === assetId);
    if (!holding) {
      throw new ItemNotFoundError(`${ownerId}/${assetId}`, 'Holding');
    }
    return holding.syncedBalance;
  }

  async getOwnerById(ownerId: string) {
    const resp = await this.queryOss<OssOwnerNodes>(OWNERS, {
      filter: {
        key: 'id',
        operator: 'EQ',
        value: ownerId,
      }, includeCerts: true, includeHoldings: false,
    });
    if (resp.users.nodes.length == 0) {
      throw new ItemNotFoundError(ownerId, 'Owner');
    }
    return resp.users.nodes[0];
  }

  async getOwnerByFinId(finId: string, includeCerts: boolean = true, includeHoldings: boolean = false) {
    const resp = await this.queryOss<OssOwnerNodes>(OWNERS, {
      filter: {
        key: 'finIds',
        operator: 'CONTAINS',
        value: finId,
      }, includeCerts, includeHoldings,
    });
    if (resp.users.nodes.length == 0) {
      throw new ItemNotFoundError(finId, 'Owner');
    }
    return resp.users.nodes[0];
  }

  async getAssets(filter?: { key: string; operator: string; value: string } | { key: string; operator: string; value: string }[]) {
    const resp = await this.queryOss<OssAssetNodes>(ASSETS, filter ? { filter } : {});
    return resp.assets.nodes;
  }

  async getAsset(assetId: string) {
    const resp = await this.queryOss<OssAssetNodes>(ASSETS, {
      filter: {
        key: 'id',
        operator: 'EQ',
        value: assetId,
      },
    });
    if (resp.assets.nodes.length == 0) {
      throw new ItemNotFoundError(assetId, 'Asset');
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
        key: 'orgId',
        operator: 'EQ',
        value: orgId,
      },
    });
    if (resp.escrows.nodes.length == 0) {
      throw new ItemNotFoundError(`${orgId}`, 'Payment asset');
    }

    const ast = resp.escrows.nodes[0].paymentAsset.assets.find(a => a.code === assetCode);
    if (!ast) {
      throw new ItemNotFoundError(`${orgId}:${assetCode}`, 'Payment asset');
    }
    return ast;
  }

  async getOrganization(orgId: string) {
    const resp = await this.queryOss<OssOrganizationNodes>(ORGANIZATIONS, {
      filter: {
        key: 'id',
        operator: 'EQ',
        value: orgId,
      },
    });
    if (resp.organizations.nodes.length == 0) {
      throw new ItemNotFoundError(orgId, 'Organization');
    }
    return resp.organizations.nodes[0];
  }

  async getLedgers() {
    const resp = await this.queryOss<OssLedgerBindingNodes>(LEDGERS, {});
    return resp.ledgers.nodes;
  }

  async getLedger(name: string) {
    const resp = await this.queryOss<OssLedgerBindingNodes>(LEDGERS, {
      filter: {
        key: 'name',
        operator: 'EQ',
        value: name,
      },
    });
    if (resp.ledgers.nodes.length == 0) {
      throw new ItemNotFoundError(name, 'Ledger');
    }
    return resp.ledgers.nodes[0];
  }

  async getApprovalConfigs() {
    const resp = await this.queryOss<OssApprovalConfigNodes>(APPROVAL_CONFIGS, {});
    return resp.approvalConfigs.nodes;
  }

  async getOwnerHoldings(ownerId: string) {
    const resp = await this.queryOss<OssOwnerNodes>(OWNERS, {
      filter: { key: 'id', operator: 'EQ', value: ownerId },
      includeCerts: false,
      includeHoldings: true,
    });
    if (resp.users.nodes.length == 0) {
      throw new ItemNotFoundError(ownerId, 'Owner');
    }
    return resp.users.nodes[0].holdings.nodes;
  }

  async getReceipts(filter?: { key: string; operator: string; value: string } | { key: string; operator: string; value: string }[]): Promise<OssReceipt[]> {
    const resp = await this.queryOss<OssReceiptNodes>(RECEIPTS, filter ? { filter } : {});
    return resp.receipts.nodes;
  }

  async getCertificates(profileId: string): Promise<OssCertificate[]> {
    // Try asset profile first
    try {
      const asset = await this.getAsset(profileId);
      if (asset.certificates?.nodes?.length) {
        return asset.certificates.nodes;
      }
    } catch {
      // not an asset — try owner
    }

    // Try owner profile
    try {
      const owner = await this.getOwnerById(profileId);
      return owner.certificates?.nodes ?? [];
    } catch {
      // not found
    }

    return [];
  }

  async getExecutionPlans(): Promise<OssExecutionPlan[]> {
    const resp = await this.queryOss<OssExecutionPlanNodes>(PLANS, {});
    return resp.plans.nodes;
  }

  async getExecutionPlan(planId: string): Promise<OssExecutionPlan> {
    const resp = await this.queryOss<OssExecutionPlanNodes>(PLANS, {
      filter: {
        key: 'id',
        operator: 'EQ',
        value: planId,
      },
    });
    if (resp.plans.nodes.length == 0) {
      throw new ItemNotFoundError(planId, 'ExecutionPlan');
    }
    return resp.plans.nodes[0];
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

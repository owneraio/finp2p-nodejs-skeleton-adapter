import 'graphql-import-node';
import * as axios from 'axios';
import { DocumentNode } from 'graphql';
import OWNERS from './graphql/owners.graphql';
import ORGANIZATIONS from './graphql/organization.graphql';
import ASSETS from './graphql/assets.graphql';
import USERS from './graphql/users.graphql';
import LEDGERS from './graphql/ledgers.graphql';
import APPROVAL_CONFIGS from './graphql/approval-configs.graphql';
import PLANS from './graphql/plans.graphql';
import RECEIPTS from './graphql/receipts.graphql';
import AGREEMENTS from './graphql/agreements.graphql';
import { makeOssPage, OssAgreement, OssAgreementNodes, OssAgreementOrder, OssAgreementStatus, OssApprovalConfigNodes, OssAsset, OssAssetNodes, OssCertificate, OssExecutionPlan, OssExecutionPlanNodes, OssInvestorNetworkAccount, OssLedgerBindingNodes, OssOrganizationNodes, OssOwnerNodes, OssPage, OssPaginate, OssReceipt, OssReceiptNodes, OssUser, OssUserNodes } from './model';
import { ItemNotFoundError } from './errors';
import { normalizeBaseUrl } from '../finapi/utils';

export type OssFilter = { key: string; operator: string; value: string };

export class OssClient {

  ossUrl: string;

  authTokenResolver: (() => string) | undefined;

  constructor(ossUrl: string, authTokenResolver: (() => string) | undefined = undefined) {
    this.ossUrl = normalizeBaseUrl(ossUrl);
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

  /**
   * List the network accounts onboarded for an investor, as projected into the
   * OSS read model. This is the read-back side of the onboarding flow — the
   * `id` on each entry is what `removeInvestorAccount` takes.
   *
   * Pass `assetId` and/or `organizationId` to narrow to a single scope;
   * filtering happens client-side because `networkAccounts` is a nested field
   * and the OSS filter applies to the `users` selection.
   */
  async getOwnerNetworkAccounts(
    ownerId: string,
    scope: { organizationId?: string; assetId?: string } = {},
  ): Promise<OssInvestorNetworkAccount[]> {
    const resp = await this.queryOss<OssOwnerNodes>(OWNERS, {
      filter: {
        key: 'id',
        operator: 'EQ',
        value: ownerId,
      },
      includeCerts: false,
      includeHoldings: false,
      includeNetworkAccounts: true,
    });
    if (resp.users.nodes.length == 0) {
      throw new ItemNotFoundError(ownerId, 'Owner');
    }
    const accounts = resp.users.nodes[0].networkAccounts ?? [];
    return accounts.filter((a) => (
      (scope.organizationId === undefined || a.organizationId === scope.organizationId)
      && (scope.assetId === undefined || a.assetId === scope.assetId)
    ));
  }

  async getAssets(
    filter?: OssFilter | OssFilter[],
    paginate?: OssPaginate,
  ): Promise<OssPage<OssAsset>> {
    const variables: Record<string, any> = {};
    if (filter) variables.filter = filter;
    if (paginate) variables.paginate = paginate;
    const resp = await this.queryOss<OssAssetNodes>(ASSETS, variables);
    return makeOssPage(resp.assets.nodes, resp.assets.pageInfo);
  }

  async getUsers(
    filter?: OssFilter | OssFilter[],
    paginate?: OssPaginate,
  ): Promise<OssPage<OssUser>> {
    const variables: Record<string, any> = {};
    if (filter) variables.filter = filter;
    if (paginate) variables.paginate = paginate;
    const resp = await this.queryOss<OssUserNodes>(USERS, variables);
    return makeOssPage(resp.users.nodes, resp.users.pageInfo);
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

  // ── Agreements ──

  /**
   * Look up agreements (resource type 107). Ordered by id unless `orderBy`
   * says otherwise.
   *
   * `filter` keys address **top-level fields of the record** — `id`,
   * `organizationId`, `status`, `businessState`, `version`, `termsType`,
   * `validFrom`, `validUntil`, `createdAt`, `updatedAt`. A key naming no field
   * at all fails the whole query rather than returning nothing, so do not
   * guess: to narrow on a nested field such as a bound party, filter on a
   * top-level field here and match the rest client-side, as
   * {@link findActiveAgreementsBetween} does.
   */
  async getAgreements(
    filter?: OssFilter | OssFilter[],
    paginate?: OssPaginate,
    orderBy?: OssAgreementOrder,
  ): Promise<OssPage<OssAgreement>> {
    const variables: Record<string, any> = {};
    if (filter) variables.filter = filter;
    if (paginate) variables.paginate = paginate;
    if (orderBy) variables.orderBy = orderBy;
    const resp = await this.queryOss<OssAgreementNodes>(AGREEMENTS, variables);
    return makeOssPage(resp.agreements.nodes ?? [], resp.agreements.pageInfo);
  }

  async getAgreement(agreementId: string): Promise<OssAgreement> {
    const resp = await this.queryOss<OssAgreementNodes>(AGREEMENTS, {
      filter: {
        key: 'id',
        operator: 'EQ',
        value: agreementId,
      },
    });
    const nodes = resp.agreements.nodes ?? [];
    if (nodes.length == 0) {
      throw new ItemNotFoundError(agreementId, 'Agreement');
    }
    return nodes[0];
  }

  /**
   * Find the standing agreements that bind both parties, newest first.
   *
   * This is the "did we already set one up?" lookup: propose an agreement once
   * and every later trade cites the id this returns.
   *
   * Only `status` and `termsType` are filtered server-side; the party match is
   * client-side against `roles[].parties`, because a role binding is a nested
   * field and the OSS filter addresses top-level fields of the record only.
   * That means `paginate.limit` bounds the rows **scanned**, not the rows
   * returned — raise it rather than assume an empty result is authoritative.
   *
   * A party is matched by exact string equality against the bound parties, so
   * pass the identifiers exactly as the proposal bound them (finId or orgId,
   * whichever the facade recorded) — not a mixture.
   */
  async findActiveAgreementsBetween(
    partyA: string,
    partyB: string,
    options: { termsType?: string; status?: OssAgreementStatus; paginate?: OssPaginate } = {},
  ): Promise<OssAgreement[]> {
    const { termsType, status = 'AGREEMENT_STATUS_ACTIVE', paginate } = options;
    const filter: OssFilter[] = [{ key: 'status', operator: 'EQ', value: status }];
    if (termsType) {
      filter.push({ key: 'termsType', operator: 'EQ', value: termsType });
    }
    const page = await this.getAgreements(filter, paginate, {
      field: 'CREATED_AT',
      direction: 'DESC',
    });
    const bound = (agreement: OssAgreement, party: string) =>
      agreement.roles.some((binding) => binding.parties.includes(party));
    return page.filter((agreement) => bound(agreement, partyA) && bound(agreement, partyB));
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

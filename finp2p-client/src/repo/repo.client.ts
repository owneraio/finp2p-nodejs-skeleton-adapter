import * as axios from 'axios';
import { generateNonce, normalizeBaseUrl } from '../finapi/utils';
import {
  ApproveRepoAgreementRequest, ApproveRepoAgreementResponse, OpenRepoTradeRequest,
  ProposeRepoAgreementRequest, ProposeRepoAgreementResponse, RejectRepoAgreementRequest,
  RejectRepoAgreementResponse, RepoAgreementAction, RepoApiError, RepoAppendedResponse,
  RepoCommandRequest, RepoProposalAction, RepoReportAction, RepoTradeAction,
} from './model';

/**
 * Encode an id as exactly **one** URL path segment.
 *
 * Ids that would change the route are refused rather than escaped: empty, `.`,
 * `..`, or containing `/`, `\` or `%` — the last because the router decodes
 * the path a second time, so an escaped `%2F` would become a separator after
 * all. `:` is left literal, since every finp2p id contains one and encoding it
 * would not match the router's routes.
 *
 * Ported from `RepoAgreementsClient.pathSegment` in the Java SDK; the two must
 * agree, because the same id has to address the same resource from either.
 */
export function pathSegment(id: string): string {
  if (!id || id === '.' || id === '..'
    || id.indexOf('/') >= 0 || id.indexOf('\\') >= 0 || id.indexOf('%') >= 0) {
    throw new Error(`Invalid id for a URL path segment: ${id}`);
  }
  return encodeURIComponent(id).replace(/%3A/g, ':');
}

function agreementPath(agreementId: string): string {
  return `/repo/agreements/${pathSegment(agreementId)}`;
}

/**
 * Client for the router's repo facade: the agreement lifecycle
 * (`/repo/agreements*`), one command per repo-v1 trade event, and the report
 * and proposal commands.
 *
 * **Document payloads are open objects**, unlike the Java SDK's typed
 * `RepoBasketDocument`, `RepoCoverageDocument` and friends. Those classes lag
 * core — the terms model alone is missing five fields callers send today — and
 * copying them into TypeScript would pin this package to a schema that moves
 * on a feature branch. The *routes*, role vocabulary and envelopes are
 * mirrored exactly; the documents inside them are yours to type.
 *
 * ```ts
 * const repo = new RepoAgreementsClient(finApiUrl, authTokenResolver);
 * const { agreementId } = await repo.proposeAgreement({
 *   parties: { pledger: { orgId: borrowerOrg }, receiver: { orgId: lenderOrg } },
 *   terms: { borrower, lender, cashAssetId, eligibleAssets },
 * });
 * await repo.approveAgreement(agreementId, { role: 'receiver', agreementVersion: 1 });
 * ```
 */
export class RepoAgreementsClient {

  finP2PUrl: string;

  authTokenResolver: (() => string) | undefined;

  constructor(finP2PUrl: string, authTokenResolver: (() => string) | undefined = undefined) {
    this.finP2PUrl = normalizeBaseUrl(finP2PUrl);
    this.authTokenResolver = authTokenResolver;
  }

  // ── agreement lifecycle ──

  /** Propose a repo pair agreement; the proposer's router owns it. */
  async proposeAgreement(
    request: ProposeRepoAgreementRequest,
    idempotencyKey?: string,
  ): Promise<ProposeRepoAgreementResponse> {
    return this.post('/repo/agreements', request, idempotencyKey);
  }

  /**
   * Consent for one of this organization's bound roles, over the addressed
   * version. `agreementVersion` is the amendment number being consented to —
   * an approval of an older version does not carry forward.
   */
  async approveAgreement(
    agreementId: string,
    request: ApproveRepoAgreementRequest,
    idempotencyKey?: string,
  ): Promise<ApproveRepoAgreementResponse> {
    return this.post(`${agreementPath(agreementId)}/approve`, request, idempotencyKey);
  }

  async rejectAgreement(
    agreementId: string,
    request: RejectRepoAgreementRequest,
    idempotencyKey?: string,
  ): Promise<RejectRepoAgreementResponse> {
    return this.post(`${agreementPath(agreementId)}/reject`, request, idempotencyKey);
  }

  /**
   * An agreement-level action: `default-notice`, `default-revocation`,
   * `closeout-default` or `termination`.
   */
  async agreementAction<P>(
    agreementId: string,
    action: RepoAgreementAction,
    request: RepoCommandRequest<P>,
    idempotencyKey?: string,
  ): Promise<RepoAppendedResponse> {
    return this.post(`${agreementPath(agreementId)}/${action}`, request, idempotencyKey);
  }

  async serveDefaultNotice<P>(agreementId: string, request: RepoCommandRequest<P>, idempotencyKey?: string) {
    return this.agreementAction(agreementId, 'default-notice', request, idempotencyKey);
  }

  async revokeDefault<P>(agreementId: string, request: RepoCommandRequest<P>, idempotencyKey?: string) {
    return this.agreementAction(agreementId, 'default-revocation', request, idempotencyKey);
  }

  async closeoutDefault<P>(agreementId: string, request: RepoCommandRequest<P>, idempotencyKey?: string) {
    return this.agreementAction(agreementId, 'closeout-default', request, idempotencyKey);
  }

  async terminate<P>(agreementId: string, request: RepoCommandRequest<P>, idempotencyKey?: string) {
    return this.agreementAction(agreementId, 'termination', request, idempotencyKey);
  }

  // ── trades ──

  /** Opens a trade; the returned `tradeId` is what every later trade command cites. */
  async openTrade<P>(
    agreementId: string,
    request: OpenRepoTradeRequest<P>,
    idempotencyKey?: string,
  ): Promise<RepoAppendedResponse> {
    return this.post(`${agreementPath(agreementId)}/trades`, request, idempotencyKey);
  }

  async tradeAction<P>(
    agreementId: string,
    tradeId: string,
    action: RepoTradeAction,
    request: RepoCommandRequest<P>,
    idempotencyKey?: string,
  ): Promise<RepoAppendedResponse> {
    const path = `${agreementPath(agreementId)}/trades/${pathSegment(tradeId)}/${action}`;
    return this.post(path, request, idempotencyKey);
  }

  async affirmTrade<P>(agreementId: string, tradeId: string, request: RepoCommandRequest<P>, idempotencyKey?: string) {
    return this.tradeAction(agreementId, tradeId, 'affirm', request, idempotencyKey);
  }

  async rejectTrade<P>(agreementId: string, tradeId: string, request: RepoCommandRequest<P>, idempotencyKey?: string) {
    return this.tradeAction(agreementId, tradeId, 'reject', request, idempotencyKey);
  }

  async registerBasket<P>(agreementId: string, tradeId: string, request: RepoCommandRequest<P>, idempotencyKey?: string) {
    return this.tradeAction(agreementId, tradeId, 'basket', request, idempotencyKey);
  }

  async declareCollateralised<P>(agreementId: string, tradeId: string, request: RepoCommandRequest<P>, idempotencyKey?: string) {
    return this.tradeAction(agreementId, tradeId, 'collateralised', request, idempotencyKey);
  }

  async requestExecution<P>(agreementId: string, tradeId: string, request: RepoCommandRequest<P>, idempotencyKey?: string) {
    return this.tradeAction(agreementId, tradeId, 'execution-request', request, idempotencyKey);
  }

  async startExecution<P>(agreementId: string, tradeId: string, request: RepoCommandRequest<P>, idempotencyKey?: string) {
    return this.tradeAction(agreementId, tradeId, 'execution-start', request, idempotencyKey);
  }

  async settleTrade<P>(agreementId: string, tradeId: string, request: RepoCommandRequest<P>, idempotencyKey?: string) {
    return this.tradeAction(agreementId, tradeId, 'settle', request, idempotencyKey);
  }

  async defaultTrade<P>(agreementId: string, tradeId: string, request: RepoCommandRequest<P>, idempotencyKey?: string) {
    return this.tradeAction(agreementId, tradeId, 'default', request, idempotencyKey);
  }

  async cancelTrade<P>(agreementId: string, tradeId: string, request: RepoCommandRequest<P>, idempotencyKey?: string) {
    return this.tradeAction(agreementId, tradeId, 'cancel', request, idempotencyKey);
  }

  async declareContainer<P>(agreementId: string, tradeId: string, request: RepoCommandRequest<P>, idempotencyKey?: string) {
    return this.tradeAction(agreementId, tradeId, 'container', request, idempotencyKey);
  }

  async raiseReport<P>(agreementId: string, tradeId: string, request: RepoCommandRequest<P>, idempotencyKey?: string) {
    return this.tradeAction(agreementId, tradeId, 'report', request, idempotencyKey);
  }

  async recordRecovery<P>(agreementId: string, tradeId: string, request: RepoCommandRequest<P>, idempotencyKey?: string) {
    return this.tradeAction(agreementId, tradeId, 'recovery', request, idempotencyKey);
  }

  // ── reports ──

  async reportAction<P>(
    agreementId: string,
    reportEventId: string,
    action: RepoReportAction,
    request: RepoCommandRequest<P>,
    idempotencyKey?: string,
  ): Promise<RepoAppendedResponse> {
    const path = `${agreementPath(agreementId)}/reports/${pathSegment(reportEventId)}/${action}`;
    return this.post(path, request, idempotencyKey);
  }

  async proposeLines<P>(agreementId: string, reportEventId: string, request: RepoCommandRequest<P>, idempotencyKey?: string) {
    return this.reportAction(agreementId, reportEventId, 'lines', request, idempotencyKey);
  }

  async setReportStatus<P>(
    agreementId: string,
    reportEventId: string,
    status: RepoReportAction,
    request: RepoCommandRequest<P>,
    idempotencyKey?: string,
  ) {
    return this.reportAction(agreementId, reportEventId, status, request, idempotencyKey);
  }

  // ── line proposals ──

  /**
   * The `reports` segment is informational — the facade reads the proposal off
   * the log by its event id — so the route carries a literal `_` in place of a
   * report id. That is not a placeholder to fill in.
   */
  async proposalAction<P>(
    agreementId: string,
    proposalEventId: string,
    action: RepoProposalAction,
    request: RepoCommandRequest<P>,
    idempotencyKey?: string,
  ): Promise<RepoAppendedResponse> {
    const path = `${agreementPath(agreementId)}/reports/_/proposals/${pathSegment(proposalEventId)}/${action}`;
    return this.post(path, request, idempotencyKey);
  }

  async approveLines<P>(agreementId: string, proposalEventId: string, request: RepoCommandRequest<P>, idempotencyKey?: string) {
    return this.proposalAction(agreementId, proposalEventId, 'approve', request, idempotencyKey);
  }

  async rejectLines<P>(agreementId: string, proposalEventId: string, request: RepoCommandRequest<P>, idempotencyKey?: string) {
    return this.proposalAction(agreementId, proposalEventId, 'reject', request, idempotencyKey);
  }

  async postLine<P>(agreementId: string, proposalEventId: string, request: RepoCommandRequest<P>, idempotencyKey?: string) {
    return this.proposalAction(agreementId, proposalEventId, 'posting', request, idempotencyKey);
  }

  async completeLines<P>(agreementId: string, proposalEventId: string, request: RepoCommandRequest<P>, idempotencyKey?: string) {
    return this.proposalAction(agreementId, proposalEventId, 'complete', request, idempotencyKey);
  }

  // ── baskets ──

  async closeBasket<P>(
    agreementId: string,
    basketId: string,
    request: RepoCommandRequest<P>,
    idempotencyKey?: string,
  ): Promise<RepoAppendedResponse> {
    const path = `${agreementPath(agreementId)}/baskets/${pathSegment(basketId)}/close`;
    return this.post(path, request, idempotencyKey);
  }

  // ── transport ──

  /**
   * Every repo command carries an `Idempotency-Key`, defaulted to a fresh
   * nonce. A fresh key per call is right for independent requests but gives no
   * deduplication on retry: if you own the retry loop, generate one key and
   * pass the same value to every attempt.
   */
  private async post<T>(path: string, body: unknown, idempotencyKey?: string): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Idempotency-Key': idempotencyKey ?? generateNonce().toString('hex'),
    };
    if (this.authTokenResolver) {
      headers.Authorization = `Bearer ${this.authTokenResolver()}`;
    }

    const response = await axios.default.post<T>(`${this.finP2PUrl}${path}`, body, {
      headers,
      validateStatus: () => true,
    });
    if (response.status < 200 || response.status >= 300) {
      throw new RepoApiError('POST', path, response.status, response.data);
    }
    return response.data;
  }

}

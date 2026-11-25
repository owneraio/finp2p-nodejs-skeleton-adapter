/**
 * Types for the router's repo facade (`POST /repo/agreements*`), mirroring
 * `io.ownera.finp2p.repo` in the Java SDK.
 *
 * These are hand-written rather than generated. The repo facade is not in
 * `application-api.base.yaml` — it lives on `feature/agreement-repo` in
 * finp2p-core and is not on master — so there is no spec to generate from, and
 * generating from a branch that moves daily would make every core commit a new
 * release of this package.
 */

/**
 * The repo-v1 emitter roles, as they go on the wire.
 *
 * Note the kebab-case: `valuation-engine`, not `valuationEngine`. The field
 * names on {@link RepoAgreementParties} are camelCase and the role *values*
 * are not, which is easy to get backwards.
 *
 * A pair binds a pledger and a receiver; venue and agent are optional. The
 * valuation engine raises and judges the margin report and the approver
 * decides the proposed asset lists; the facade binds both to the receiver
 * unless the proposal names another party.
 */
export type RepoAgreementRole =
  | 'pledger'
  | 'receiver'
  | 'venue'
  | 'agent'
  | 'valuation-engine'
  | 'approver'
  | 'calculation-agent';

/** A party bound to a repo role, by organization id. */
export type RepoParty = { orgId: string };

/**
 * The pair's role bindings.
 *
 * `pledger` and `receiver` are what make it a pair, so they are required here
 * even though the Java model leaves every field nullable.
 */
export type RepoAgreementParties = {
  /** Cash borrower, collateral giver. */
  pledger: RepoParty;
  /** Cash lender, collateral receiver; the basket controller bilaterally. */
  receiver: RepoParty;
  /** Books trades (`trade-booked`); not a party to the master agreement. */
  venue?: RepoParty;
  /** Tri-party agent taking the receiver's basket duties. */
  agent?: RepoParty;
  /** Raises and judges the trade's margin report; the receiver when omitted. */
  valuationEngine?: RepoParty;
  /** Decides the proposed asset lists; the receiver when omitted. */
  approver?: RepoParty;
  /** Selects the assets covering each report; when bound it proposes the lines, not the pledger. */
  calculationAgent?: RepoParty;
};

/**
 * The application terms payload, deliberately untyped.
 *
 * The Java SDK models this as a closed `RepoTerms` class, and that class is
 * **behind core** — it has no `eligibleAssets`, `cashCurrency`,
 * `collateralPlatform`, `addressBook` or `haircutConvention`, all of which
 * callers send today. Terms are opaque to the network (the router stores them
 * base64-encoded and parses nothing), so typing them here would buy no
 * safety and would make every core schema change a breaking change in this
 * package. Give the shape a name in your own code if you want one.
 */
export type RepoTerms = Record<string, unknown>;

/** Body of `POST /repo/agreements`. */
export type ProposeRepoAgreementRequest = {
  parties: RepoAgreementParties;
  terms: RepoTerms;
  /**
   * Application schema tag for `terms`. The repo facade stamps `repo-terms/v1`
   * itself, so leave this unset unless you are deliberately overriding it; it
   * is sent only when present.
   */
  termsType?: string;
  /** Roles whose approval activates the agreement; pledger and receiver when omitted. */
  consentRoles?: RepoAgreementRole[];
  /** Epoch seconds; now when omitted. */
  validFrom?: number;
  /** Epoch seconds; one year from now when omitted. */
  validUntil?: number;
};

export type ProposeRepoAgreementResponse = { agreementId: string };

/** Body of `POST /repo/agreements/{id}/approve`. */
export type ApproveRepoAgreementRequest = {
  /** One of *this organization's* bound roles. */
  role: RepoAgreementRole;
  /** The amendment number being consented to. */
  agreementVersion: number;
};

export type ApproveRepoAgreementResponse = { status: string };

/**
 * Body of `POST /repo/agreements/{id}/reject`.
 *
 * Note this is **not** the approve body: reject carries a `reason`, not an
 * `agreementVersion`.
 */
export type RejectRepoAgreementRequest = {
  role: RepoAgreementRole;
  reason?: string;
};

export type RejectRepoAgreementResponse = { status: string };

/**
 * Every command other than propose/approve/reject: the role this organization
 * emits as, and the event's document.
 *
 * `payload` is open for the same reason {@link RepoTerms} is: the document
 * schemas live in core and move with it.
 */
export type RepoCommandRequest<P = Record<string, unknown>> = {
  role: RepoAgreementRole;
  /** Optional where the event schema requires no document. */
  payload?: P;
};

/** Body of `POST /repo/agreements/{id}/trades`. */
export type OpenRepoTradeRequest<P = Record<string, unknown>> = {
  role: RepoAgreementRole;
  /** `trade-proposed` by a party, `trade-booked` by the venue (the default for that role). */
  event?: string;
  payload?: P;
};

/** Where a command's event landed on the agreement log. */
export type RepoAppendedResponse = {
  eventId: string;
  sequence: number;
  tradeId?: string;
  basketId?: string;
  containerKey?: string;
  collateralMode?: string;
  reportId?: string;
};

export type RepoTradeAction =
  | 'affirm' | 'reject' | 'basket' | 'container' | 'report' | 'collateralised'
  | 'execution-request' | 'execution-start' | 'settle' | 'default' | 'cancel' | 'recovery';

export type RepoReportAction = 'lines' | 'complete' | 'incomplete' | 'resolve' | 'reject';

export type RepoProposalAction = 'approve' | 'reject' | 'posting' | 'complete';

export type RepoAgreementAction =
  | 'default-notice' | 'default-revocation' | 'closeout-default' | 'termination';

/** A non-2xx answer from the repo facade. */
export class RepoApiError extends Error {

  readonly status: number;

  readonly body: unknown;

  constructor(method: string, path: string, status: number, body: unknown) {
    super(`${method} ${path} failed with ${status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
    this.name = 'RepoApiError';
    this.status = status;
    this.body = body;
  }

}

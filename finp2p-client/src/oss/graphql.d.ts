export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> };
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> };
export type MakeEmpty<T extends { [key: string]: unknown }, K extends keyof T> = { [_ in K]?: never };
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
};

/** Account identifier - supports FinP2P, crypto wallets, and IBAN */
export type AccountIdentifier = CryptoWalletAccount | FinP2PAccount | Iban;

/** Custody account creation. */
export type AccountOperation = Operation & {
  __typename?: 'AccountOperation';
  cid: Scalars['String']['output'];
  completionTimestamp?: Maybe<Scalars['Int']['output']>;
  creationTimestamp?: Maybe<Scalars['Int']['output']>;
  custodyAccountKey?: Maybe<Scalars['String']['output']>;
  error?: Maybe<OperationError>;
  isCompleted: Scalars['Boolean']['output'];
  isFailed: Scalars['Boolean']['output'];
  organizationId?: Maybe<Scalars['String']['output']>;
  status: Scalars['String']['output'];
  type: Scalars['String']['output'];
  workflowIds?: Maybe<Array<Scalars['String']['output']>>;
};

/** Account-scoped authorization policy (provisioningSpec template projection; signer payloads are not exposed). */
export type AccountPolicy = {
  __typename?: 'AccountPolicy';
  /** resource id of the agreement the policy is projected from */
  agreementRef: Scalars['String']['output'];
  /** agreement roles allowed to initiate movements on the governed accounts */
  allowedInitiatorRoles: Array<Scalars['String']['output']>;
  /** standing M-of-N authorization rule */
  authorization?: Maybe<AccountPolicyAuthorization>;
  /** agreement role of the beneficial owner of the governed accounts */
  beneficialOwnerRole: Scalars['String']['output'];
  /** STAMPED: the specific investor party the governed container is bounded to; empty = role-bounded */
  boundParty: Scalars['String']['output'];
  /** named conditions overriding the standing rules once asserted */
  conditions: Array<AccountPolicyCondition>;
  constraints?: Maybe<AccountPolicyConstraints>;
  /** movement directions the policy governs (POLICY_DIRECTION_INFLOW, POLICY_DIRECTION_OUTFLOW, POLICY_DIRECTION_BOTH) */
  direction: Scalars['String']['output'];
  eligibility?: Maybe<AccountPolicyEligibility>;
  /** stable policy identity, kept across amendments */
  policyId: Scalars['String']['output'];
  /** party co-signature entries (identities only) */
  signers: Array<AccountPolicySigner>;
  /** policy version; amendments strictly increase it */
  version: Scalars['Int']['output'];
};

/** M-of-N rule over roles: the threshold counts satisfied roles. */
export type AccountPolicyAuthorization = {
  __typename?: 'AccountPolicyAuthorization';
  requiredRoles: Array<Scalars['String']['output']>;
  requiredSigners: Array<Scalars['String']['output']>;
  threshold: Scalars['Int']['output'];
};

/** Named policy condition; while active its authorization and constraints replace the standing rules. */
export type AccountPolicyCondition = {
  __typename?: 'AccountPolicyCondition';
  authorization?: Maybe<AccountPolicyAuthorization>;
  constraints?: Maybe<AccountPolicyConstraints>;
  name: Scalars['String']['output'];
  trigger?: Maybe<AccountPolicyTrigger>;
};

/** Counterparty constraints of an account policy. */
export type AccountPolicyConstraints = {
  __typename?: 'AccountPolicyConstraints';
  allowedCounterAssetTypes: Array<Scalars['String']['output']>;
  allowedCounterFinIds: Array<Scalars['String']['output']>;
  allowedCounterOrganizations: Array<Scalars['String']['output']>;
  allowedCounterRoles: Array<Scalars['String']['output']>;
};

/** Asset-matching eligibility criteria of an account policy. */
export type AccountPolicyEligibility = {
  __typename?: 'AccountPolicyEligibility';
  assetCodes: Array<Scalars['String']['output']>;
  assetNameRegexp: Scalars['String']['output'];
  assetTypes: Array<Scalars['String']['output']>;
  ledgerNames: Array<Scalars['String']['output']>;
};

/** One policy co-signature entry - the signing party identity (no signature payload). */
export type AccountPolicySigner = {
  __typename?: 'AccountPolicySigner';
  signerParty: Scalars['String']['output'];
};

/** What activates a policy condition; type carries the PolicyTriggerType value name (POLICY_TRIGGER_TYPE_*). */
export type AccountPolicyTrigger = {
  __typename?: 'AccountPolicyTrigger';
  asserterRole: Scalars['String']['output'];
  type: Scalars['String']['output'];
};

export enum ActionType {
  Request = 'request',
  Send = 'send',
  Unknown = 'unknown',
}

export type AdditionalContractDetails = {
  __typename?: 'AdditionalContractDetails';
  finP2PEVMOperatorDetails?: Maybe<FinP2PevmOperatorDetails>;
};

/** Apply an aggregation function on specified Object's field. */
export type Aggregate = {
  /** Object's field to which apply the AggregateFunc */
  field?: InputMaybe<Scalars['String']['input']>;
  /** AggregateFunc to apply on the provided Field. */
  func: AggregateFunc;
};

/** Aggregation function to be applied on Object's numeric field. */
export enum AggregateFunc {
  Avg = 'AVG',
  Count = 'COUNT',
  Max = 'MAX',
  Min = 'MIN',
  Sum = 'SUM',
}

/** Result of Aggregation function applied on an Object numeric field. */
export type AggregateResult = {
  __typename?: 'AggregateResult';
  /** The Object's field which this results refer to. */
  field: Scalars['String']['output'];
  /** The AggregateFunc which this AggregateResult refers to. */
  func: AggregateFunc;
  result: Scalars['String']['output'];
};

/** Multi-party Agreement resource (resource type 107) projected into the read model. */
export type Agreement = {
  __typename?: 'Agreement';
  /** container accounts registry (owner-materialized current state) */
  accounts: Array<AgreementAccount>;
  /**
   * position in the definition's state machine. Empty until the machine assigns
   * the initial state on approval, and empty on agreements with no definition.
   * Router-governed: never authored, never amended, and outside the signed
   * contract zone
   */
  businessState: Scalars['String']['output'];
  /** roles whose signatures bind the agreement */
  consentRoles: Array<Scalars['String']['output']>;
  /** epoch seconds the owning router first persisted the agreement; the same on every org. 0 when unset */
  createdAt: Scalars['Int']['output'];
  /** co-signed state machine of the contract zone, fixed at proposal time; null when the agreement declares none */
  definition?: Maybe<AgreementDefinition>;
  /** explicit CAIP-19 list of assets eligible under the agreement */
  eligibleAssets: Array<AgreementEligibleAsset>;
  /** append-only operational event log */
  events: Array<AgreementEventEntry>;
  /** agreement resource id (orgId:107:rawId), the identifier account policies reference via agreementRef */
  id: Scalars['String']['output'];
  /** organization owning (originating) the agreement resource */
  organizationId: Scalars['String']['output'];
  /** org-level access list */
  participants: Array<AgreementParticipant>;
  /**
   * every refusal this agreement attracted, oldest first. Non-empty implies
   * status AGREEMENT_STATUS_REJECTED.
   *
   * Empty says nothing on its own: an agreement may also be
   * AGREEMENT_STATUS_TERMINATED by running its course, and the two terminal
   * statuses mean opposite things - one was turned down, the other completed
   */
  rejections?: Maybe<Array<AgreementRejection>>;
  /** role bindings: open-string role to the parties bound to it */
  roles: Array<AgreementRoleBinding>;
  /** the agreement's setup arm; null when the agreement declares none */
  setup?: Maybe<AgreementSetup>;
  /** party consent signatures over the contract zone (who signed for which role; no signature payloads) */
  signatures: Array<AgreementConsentSignature>;
  /** lifecycle status (AGREEMENT_STATUS_DRAFT, AGREEMENT_STATUS_PROPOSED, AGREEMENT_STATUS_ACTIVE, AGREEMENT_STATUS_SUSPENDED, AGREEMENT_STATUS_TERMINATED) */
  status: Scalars['String']['output'];
  /** base64-encoded application terms payload, opaque to the network */
  terms: Scalars['String']['output'];
  /** application schema tag telling apps how to parse the terms payload */
  termsType: Scalars['String']['output'];
  /** epoch seconds of the owning router's last write to the agreement; the same on every org once replicated, never moving back. 0 when unset. Several writes can share a second: to find changes since a time, filter with GTE and de-duplicate by id */
  updatedAt: Scalars['Int']['output'];
  /** validity window start (epoch seconds) */
  validFrom: Scalars['Int']['output'];
  /** validity window end (epoch seconds) */
  validUntil: Scalars['Int']['output'];
  /** amendment number; contract-zone changes bump it */
  version: Scalars['Int']['output'];
};

/** One entry of an agreement's container accounts registry. */
export type AgreementAccount = {
  __typename?: 'AgreementAccount';
  /** id of the agreement the registry entry belongs to */
  agreementId: Scalars['String']['output'];
  /** custodian organization of the account, empty when none */
  custodianOrgId: Scalars['String']['output'];
  /** container account finId (hex-encoded public key) */
  finId: Scalars['String']['output'];
  /** per-asset ledger footprints of the container */
  footprints: Array<AgreementAssetFootprint>;
  /** every provisioning step that failed for the container, each with its reason; what a provisioning retry re-runs. Assets that onboarded show up in footprints */
  issues: Array<AgreementContainerIssue>;
  /** organization where the account is registered */
  orgId: Scalars['String']['output'];
  /** account policy governing the container */
  policyId: Scalars['String']['output'];
  policyVersion: Scalars['Int']['output'];
  /** role of the provisioner that materialized the container */
  provisionerRole: Scalars['String']['output'];
  /** agreement roles the container serves */
  servesRoles: Array<Scalars['String']['output']>;
  /** the authored container declaration this entry materializes (copy+verify binding) */
  spec?: Maybe<ContainerSpec>;
  /** registry entry status: ACTIVE, DEGRADED (provisioned with issues: some eligible assets failed to onboard, or the container could not be shared with a participant), ONBOARDING_FAILED (no asset onboarded, the container holds no asset) or RETIRED */
  status: Scalars['String']['output'];
};

/** Results for agreementAccounts query - the container accounts registry across agreements. */
export type AgreementAccounts = {
  __typename?: 'AgreementAccounts';
  /** Collection of container account registry entries, conforms to the Filter input if provided. */
  nodes?: Maybe<Array<AgreementAccount>>;
  /** Keeps pagination info in-case limit input was provided */
  pageInfo?: Maybe<PageInfo>;
};

/** Ledger-level footprint of a container account for one CAIP-19 asset. */
export type AgreementAssetFootprint = {
  __typename?: 'AgreementAssetFootprint';
  network: Scalars['String']['output'];
  /** ledger account (e.g. on-chain address) serving the asset */
  networkAccount: Scalars['String']['output'];
  standard: Scalars['String']['output'];
  tokenId: Scalars['String']['output'];
};

/** Consent signature entry of an agreement's contract zone (signature payload not exposed). */
export type AgreementConsentSignature = {
  __typename?: 'AgreementConsentSignature';
  /** consent role the signature satisfies */
  role: Scalars['String']['output'];
  /** bound party that signed */
  signerParty: Scalars['String']['output'];
};

/** One failed provisioning step of a container. */
export type AgreementContainerIssue = {
  __typename?: 'AgreementContainerIssue';
  /** error code of the failure; null when none was reported */
  errorCode?: Maybe<Scalars['Int']['output']>;
  /** reason of the failure; null when none was reported */
  errorMessage?: Maybe<Scalars['String']['output']>;
  /** CAIP-19 network of the asset the issue concerns; null when the issue is not about an asset */
  network?: Maybe<Scalars['String']['output']>;
  /** CAIP-19 standard of the asset; null when the issue is not about an asset */
  standard?: Maybe<Scalars['String']['output']>;
  /** state of the issue, such as failed; new statuses may appear */
  status: Scalars['String']['output'];
  /** the provisioning step that failed, such as asset-onboarding or profile-share; new steps may appear, so treat unknown values as opaque */
  step: Scalars['String']['output'];
  /** what the step failed for: the asset id (the asset's CAIP-19 when it resolves to no asset) for asset-onboarding, the participant organization id for profile-share */
  subject: Scalars['String']['output'];
  /** CAIP-19 token id of the asset; null when the issue is not about an asset */
  tokenId?: Maybe<Scalars['String']['output']>;
};

/**
 * The agreement's authored state machine, part of the co-signed contract zone and fixed once proposed.
 * Projected verbatim: the read model neither evaluates transitions nor derives a current state.
 */
export type AgreementDefinition = {
  __typename?: 'AgreementDefinition';
  /** event types the definition admits */
  allowedEvents: Array<AgreementDefinitionAllowedEvent>;
  /**
   * reference to the published document this machine was taken from - fetch
   * `dslSource.reference.fullUrl` to show the DSL source. Digest-pinned like every
   * other schema reference, because the proposing router read it and each
   * approving org re-read it before signing. Null when the agreement declares
   * none, which is every agreement proposed before the field existed.
   *
   * Informational, and NOT how the machine is obtained: the definition on this
   * same node IS the machine, co-signed and authoritative, and is what a
   * visualization must be drawn from. The referenced document is the published
   * TEMPLATE and differs from the copy here - it carries none of the paths,
   * digests and urls the router pins at propose - and nothing checks that this
   * agreement's machine was actually taken from it
   */
  dslSource?: Maybe<AgreementSchema>;
  /** agreement roles allowed to emit events against this definition */
  emitterRoles: Array<Scalars['String']['output']>;
  /** definition-level guard expression, opaque to the network */
  guard: Scalars['String']['output'];
  /** a human label for the machine, not an identifier: it need not be unique, nothing resolves an agreement by it, and it is co-signed so an amendment cannot change it */
  name: Scalars['String']['output'];
  /** payload schema reference for the definition; null when none is declared */
  schema?: Maybe<AgreementSchema>;
  /** state vocabulary and the two router-assigned entry points; null when the definition declares no machine */
  states?: Maybe<AgreementDefinitionStates>;
  /** edges of the machine */
  transitions: Array<AgreementDefinitionTransition>;
  /** definition version, authored by the application; like name, a label rather than a key */
  version: Scalars['String']['output'];
};

/** One event type the definition admits, with its optional payload schema. */
export type AgreementDefinitionAllowedEvent = {
  __typename?: 'AgreementDefinitionAllowedEvent';
  /**
   * ADMISSION guard for this event type: it must hold for an event of this type
   * to be appended. Distinct from a transition guard, which decides which state
   * edge fires. Empty when the type is unconditionally admissible
   */
  guard: Scalars['String']['output'];
  /** payload schema reference; null when none is declared */
  schema?: Maybe<AgreementSchema>;
  /** the event type */
  type: Scalars['String']['output'];
};

/**
 * The state machine's vocabulary plus the two entry points the ROUTER assigns from
 * protocol facts: onCreation when the agreement is proposed, onApproval once every
 * consentRole has signed. Neither is authored on an event nor moved by a
 * transition - everything after onApproval moves only through transitions.
 *
 * onApproval is also where the event-driven life begins: while the agreement is
 * still in onCreation it has not been consented, so no event is admissible.
 */
export type AgreementDefinitionStates = {
  __typename?: 'AgreementDefinitionStates';
  /** every state the machine may occupy - a closed vocabulary */
  allowedStates: Array<Scalars['String']['output']>;
  /** terminal states; reaching one TERMINATES the agreement, which closes the event log */
  finalStates: Array<Scalars['String']['output']>;
  /** state entered once every consentRole has signed - the first state of the event-driven life */
  onApproval: Scalars['String']['output'];
  /** state a newly proposed agreement enters */
  onCreation: Scalars['String']['output'];
};

/** One edge of the definition state machine. */
export type AgreementDefinitionTransition = {
  __typename?: 'AgreementDefinitionTransition';
  /** event type driving the transition */
  event: Scalars['String']['output'];
  /** states the transition may fire from */
  fromStates: Array<Scalars['String']['output']>;
  /** transition guard expression, opaque to the network */
  guard: Scalars['String']['output'];
  /**
   * narrows what a declaring event may choose to this subset of allowedStates;
   * only meaningful with targetSelectableByEvent. Null means UNCONSTRAINED (any
   * allowedStates member) - distinct from an empty list, which the authoring
   * surface rejects outright
   */
  selectableStates?: Maybe<Array<Scalars['String']['output']>>;
  /**
   * when true the EVENT names the state this edge moves to, in
   * after.changeStateTo, instead of the edge fixing it. The transition table
   * stays an authorisation list either way: allowedStates membership,
   * fromStates and the guard all still apply
   */
  targetSelectableByEvent: Scalars['Boolean']['output'];
  /**
   * state entered when the transition fires. With targetSelectableByEvent set
   * this is the DEFAULT, used only when the event declares nothing — read it
   * alongside that flag, never alone, or a selectable edge reads as fixed
   */
  toState: Scalars['String']['output'];
};

/** CAIP-19 ledger asset identifier listed as eligible under an agreement. */
export type AgreementEligibleAsset = {
  __typename?: 'AgreementEligibleAsset';
  network: Scalars['String']['output'];
  standard: Scalars['String']['output'];
  tokenId: Scalars['String']['output'];
};

/**
 * An event's assertion about the agreement after it is applied - the `do` oneof
 * of the event envelope, at most one member set.
 *
 * Kept as an OBJECT rather than flattened onto the event (the way both arms of
 * the reference oneof flatten into referencedEventIds) because these are not two
 * shapes of one fact: the oneof is a discriminated union of different assertions,
 * built to grow. A new arm becomes another optional member here, and the object
 * being null still reads as "this event asserted nothing" - which a flattened
 * field could not express once a second arm existed. It also keeps the read model
 * spelled the same way as the write API, where an author sends after.changeStateTo.
 */
export type AgreementEventAfter = {
  __typename?: 'AgreementEventAfter';
  /**
   * the state this event declares the agreement moves to. Honoured only on an
   * edge declaring targetSelectableByEvent; the router refuses a declaration no
   * edge authorises rather than ignoring it, so a value here that reached the
   * log was accepted by the machine
   */
  changeStateTo?: Maybe<Scalars['String']['output']>;
};

/** One entry of an agreement's append-only event log. */
export type AgreementEventEntry = {
  __typename?: 'AgreementEventEntry';
  /**
   * what this event ASSERTS about the agreement after it is applied; null when
   * it asserts nothing, which is the common case. Signed by the emitter (event
   * digest v2) because it selects the transition target and therefore finality
   */
  after?: Maybe<AgreementEventAfter>;
  /**
   * organization that SENT this event, observed by the router from the request
   * envelope rather than taken from the body. Empty on events appended before the
   * field existed.
   *
   * Use this, not emitterRole, to attribute an event: a role may bind several
   * organizations
   */
  emitterOrgId: Scalars['String']['output'];
  /** agreement role of the emitter */
  emitterRole: Scalars['String']['output'];
  /** open-string event type (application vocabulary) */
  eventType: Scalars['String']['output'];
  id: Scalars['String']['output'];
  /** event time (epoch seconds) */
  occurredAt: Scalars['Int']['output'];
  /** base64-encoded opaque payload, null when the event carries none */
  payload?: Maybe<Scalars['String']['output']>;
  /** application schema tag for the payload */
  payloadType: Scalars['String']['output'];
  /**
   * organizations this event is DIRECTED AT, in authored order; null when
   * directed at no one, the ordinary case.
   *
   * NOT an access control list - an addressed event is readable by every
   * participant, exactly as an undirected one is. It lets a definition express a
   * lifecycle precisely, so render it as addressing and never as permission
   */
  receiverOrgIds?: Maybe<Array<Scalars['String']['output']>>;
  /**
   * ids of the events this one points at, in the order authored; null when it
   * references nothing. Both arms of the reference oneof flatten into this one
   * list - a single reference is a list of one. Every id is guaranteed to
   * resolve to an event on the same agreement, so walking lineage never hits a
   * dangling pointer
   */
  referencedEventIds?: Maybe<Array<Scalars['String']['output']>>;
  /** monotonic per-agreement sequence */
  sequence: Scalars['Int']['output'];
};

export type AgreementOrder = {
  direction?: InputMaybe<SortOrder>;
  field?: InputMaybe<AgreementOrderField>;
};

export enum AgreementOrderField {
  /** Ordered by when the owning router first persisted the agreement */
  CreatedAt = 'CREATED_AT',
  /** Ordered by the agreement resource id */
  Id = 'ID',
  /** Ordered by the owning router's last write to the agreement */
  UpdatedAt = 'UPDATED_AT',
}

/** One entry of an agreement's org-level access list. */
export type AgreementParticipant = {
  __typename?: 'AgreementParticipant';
  organizationId: Scalars['String']['output'];
  /** access roles of the organization (Observer, Contributor) */
  roles: Array<Scalars['String']['output']>;
};

/** Co-signed provisioning outline: default provisioner role and template, plus the declared container whitelist. */
export type AgreementProvisioningSpec = {
  __typename?: 'AgreementProvisioningSpec';
  /** declared containers (closed whitelist); empty = one implicit multi-chain default container */
  containers: Array<ContainerSpec>;
  /** DEFAULT role-native account policy template (instance fields stay empty until stamped at provisioning) */
  policyTemplate?: Maybe<AccountPolicy>;
  /** DEFAULT agreement role whose bound organization provisions containers not overriding it */
  provisionerRole: Scalars['String']['output'];
};

/**
 * One party's refusal of an agreement, recorded by the owner.
 *
 * The ORGANIZATION identifies a rejector. The role is context only, because the
 * same role name binds in several organizations - and more than one may refuse the
 * same proposal independently, which is why an agreement carries a list.
 */
export type AgreementRejection = {
  __typename?: 'AgreementRejection';
  /** the amendment number that was refused */
  agreementVersion?: Maybe<Scalars['Int']['output']>;
  /** machine-readable cause, e.g. UnsupportedTermsType */
  code?: Maybe<Scalars['String']['output']>;
  /** the organization that refused */
  orgId: Scalars['String']['output'];
  /** human-readable detail */
  reason?: Maybe<Scalars['String']['output']>;
  /** when it was refused (epoch seconds) */
  rejectedAt?: Maybe<Scalars['Int']['output']>;
  /** the bound role it refused under; context, not identity */
  role?: Maybe<Scalars['String']['output']>;
};

/** Binding of an open-string agreement role to the parties that may act for it. */
export type AgreementRoleBinding = {
  __typename?: 'AgreementRoleBinding';
  parties: Array<Scalars['String']['output']>;
  role: Scalars['String']['output'];
};

/**
 * A named, versioned schema reference. When it carries a url, the router fetches
 * the document at propose, records its digest here, and validates the matching
 * payload against it — the terms for an agreement's own schema, the event payload
 * for an allowed event type's. A reference with no url is documentation: nothing
 * is fetched and nothing is validated.
 */
export type AgreementSchema = {
  __typename?: 'AgreementSchema';
  /** schema name */
  name: Scalars['String']['output'];
  /** the reference arm, if one is set */
  reference?: Maybe<AgreementSchemaReference>;
  /** schema version */
  version: Scalars['String']['output'];
};

/**
 * The document-KEY arm of a schema reference: the document is named within the
 * network's schema registry and the router prepends its configured prefix, so a
 * published definition authors no host. `fullUrl` records the one the proposing
 * router actually read from.
 */
export type AgreementSchemaDocumentReference = {
  __typename?: 'AgreementSchemaDocumentReference';
  /** format of the schema document (e.g. json-schema) */
  format: Scalars['String']['output'];
  /** where the PROPOSING router read this document from - its configured prefix joined to key and path, recorded at propose beside the digest of what it read. Null on agreements proposed before the field existed. A SNAPSHOT, not an address: nothing resolves against it, and the definition cannot be amended, so it can never be corrected. Use it to show provenance, and re-derive from key and path when you need a location that is still live */
  fullUrl?: Maybe<Scalars['String']['output']>;
  /** content digest of the document as SERVED. It matters more on this arm than on a url: a registry key is not content-addressed, so the digest is what detects a published version being edited underneath a signature */
  hash?: Maybe<AgreementSchemaHash>;
  /** the versioned bundle the document belongs to - the agreement's termsType verbatim, e.g. collateral-terms/v1 */
  key: Scalars['String']['output'];
  /** location within the key. Derived from the schema name when the author leaves it out, and pinned by the router at propose, so a stored agreement always names the document it resolved */
  path: Scalars['String']['output'];
};

/** Content digest of an external schema document, with the algorithm that produced it. */
export type AgreementSchemaHash = {
  __typename?: 'AgreementSchemaHash';
  /** the digest */
  hash: Scalars['String']['output'];
  /** the algorithm that produced it */
  hashAlgorithm: Scalars['String']['output'];
};

/**
 * Arms of a schema reference (a oneof). Which arm a definition uses says how the
 * document is ADDRESSED: a url names it outright and is the only way to reference
 * something immutable, while a document key names it within the network's schema
 * registry and lets the router supply the host.
 */
export type AgreementSchemaReference = AgreementSchemaDocumentReference | AgreementSchemaUrlReference;

/** The URL arm of a schema reference. */
export type AgreementSchemaUrlReference = {
  __typename?: 'AgreementSchemaUrlReference';
  /** format of the schema document (e.g. json-schema) */
  format: Scalars['String']['output'];
  /** content digest of the document as SERVED, written by the router at propose and re-verified by every org before it signs, so the parties consent to schema content rather than to a pointer. Null when the reference carries no url */
  hash?: Maybe<AgreementSchemaHash>;
  /** location of the schema document */
  url: Scalars['String']['output'];
};

/**
 * The agreement's type-specific setup, a mutually-exclusive arm of the protocol's
 * `setup` oneof. A provisioning outline is a COLLATERAL concern — an agreement type
 * that owns no containers has no use for one — so setup arms are per-type rather
 * than a field every agreement carries and most leave null.
 *
 * One arm today. A second is purely additive: add the member here, and consumers
 * already writing `... on` fragments keep compiling.
 */
export type AgreementSetup = AgreementProvisioningSpec;

/** Results for agreements query. */
export type Agreements = {
  __typename?: 'Agreements';
  /** Collection of Agreement objects, conforms to the Filter input if provided. */
  nodes?: Maybe<Array<Agreement>>;
  /** Keeps pagination info in-case limit input was provided */
  pageInfo?: Maybe<PageInfo>;
};

export type ApprovalConfig = {
  __typename?: 'ApprovalConfig';
  config: Scalars['String']['output'];
  createdAt: Scalars['String']['output'];
  /** proposal approval configuration */
  id: Scalars['String']['output'];
};

export type ApprovalConfigs = {
  __typename?: 'ApprovalConfigs';
  nodes?: Maybe<Array<ApprovalConfig>>;
  /** Keeps pagination info in-case limit input was provided */
  pageInfo?: Maybe<PageInfo>;
};

export enum ApprovalStatus {
  Approved = 'Approved',
  Rejected = 'Rejected',
  Unknown = 'Unknown',
}

/** Represents an Asset in the network. */
export type Asset = Profile & {
  __typename?: 'Asset';
  /** to fallback to default allowed policy if no specific policy is set */
  allowPolicyDefaultFallback: Scalars['Boolean']['output'];
  /** Allowed intent types to be used on the asset */
  allowedIntents?: Maybe<Array<IntentTypes>>;
  /** whether the asset is auto-shared */
  autoShare: Scalars['Boolean']['output'];
  /** Collection of certificates associated with the Profile. */
  certificates: Certificates;
  /** Custom configuration for the Asset. */
  config: Scalars['String']['output'];
  /** Data providers declared on the asset profile: where the asset's data comes from. */
  dataProviders?: Maybe<Array<AssetDataProvider>>;
  /** decimal places for the asset */
  decimalPlaces: Scalars['Int']['output'];
  /** Denomination currency of the Asset */
  denomination: FiatAsset;
  /** classification standard used to identify the financial asset */
  financialIdentifier?: Maybe<FinancialIdentifier>;
  id: Scalars['String']['output'];
  /** Collection of Intents associated with the Asset. */
  intents: Intents;
  /**
   * Tokens issued for the given Asset. paginate is opt-in: when omitted the full
   * cap table is returned and pageInfo stays null (pre-pagination behavior).
   */
  issuedTokens: TokensBalances;
  /** Issuer profile of the Asset. */
  issuerId: Scalars['String']['output'];
  /** Org-local labels computed by the router; filter via key `labels.<key>`. */
  labels?: Maybe<Array<KeyValuePair>>;
  /** ledgerAssetInfo information */
  ledgerAssetInfo?: Maybe<LedgerAssetInfo>;
  /** Profile metadata, contains ACL information of the profile. */
  metadata: ProfileMetadata;
  name: Scalars['String']['output'];
  /** Organization id to whom this profile is associated with. */
  organizationId: Scalars['String']['output'];
  /** Describe the policies active on the asset */
  policies?: Maybe<AssetPolicies>;
  /** Regulation Verifiers associated with the Asset. */
  regulationVerifiers?: Maybe<Array<Verifier>>;
  symbol?: Maybe<Scalars['String']['output']>;
  /** Type of Asset (Share, Debt etc..) */
  type: Scalars['String']['output'];
  /** asset resource version */
  version: Scalars['String']['output'];
};


/** Represents an Asset in the network. */
export type AssetCertificatesArgs = {
  aggregates?: InputMaybe<Array<Aggregate>>;
  filter?: InputMaybe<Array<Filter>>;
  where?: InputMaybe<FilterExpr>;
};


/** Represents an Asset in the network. */
export type AssetIntentsArgs = {
  aggregates?: InputMaybe<Array<Aggregate>>;
  filter?: InputMaybe<Array<Filter>>;
  where?: InputMaybe<FilterExpr>;
};


/** Represents an Asset in the network. */
export type AssetIssuedTokensArgs = {
  aggregates?: InputMaybe<Array<Aggregate>>;
  filter?: InputMaybe<Array<Filter>>;
  paginate?: InputMaybe<PaginateInput>;
  where?: InputMaybe<FilterExpr>;
};

/** Identifier type for asset data */
export enum AssetDataIdentifierType {
  Caip19 = 'CAIP19',
  Isin = 'ISIN',
}

/** Represents financial data for an asset from a data provider */
export type AssetDataItem = {
  __typename?: 'AssetDataItem';
  /** When the record was created */
  createdAt: Scalars['Int']['output'];
  /** The actual data as JSON string */
  data: Scalars['String']['output'];
  /** Type of financial data */
  dataType: DataType;
  id: Scalars['String']['output'];
  /** Type of identifier used (ISIN or CAIP19) */
  identifierType: AssetDataIdentifierType;
  /** The identifier value (e.g., US0378331005 for ISIN) */
  identifierValue: Scalars['String']['output'];
  /** Provider timestamp (epoch ms) */
  providerTimestamp?: Maybe<Scalars['Int']['output']>;
  /** Data provider source identifier */
  source?: Maybe<Scalars['String']['output']>;
  /** When the record was last updated */
  updatedAt: Scalars['Int']['output'];
};

/** A data provider declared on an asset profile (the source of a data type for the asset). */
export type AssetDataProvider = {
  __typename?: 'AssetDataProvider';
  /** Data types this provider supplies for the asset. */
  dataTypes?: Maybe<Array<Scalars['String']['output']>>;
  /** For a 'finp2p' provider this is the peer org id; for 'adapter' the bound adapter name. */
  providerName: Scalars['String']['output'];
  /** Provider type: 'adapter' or 'finp2p'. */
  providerType: Scalars['String']['output'];
};

/** Results for asset data query. */
export type AssetDatas = {
  __typename?: 'AssetDatas';
  /** Collection of AssetDataItem Objects, conforms to the Filter input if provided. */
  nodes?: Maybe<Array<AssetDataItem>>;
  /** Keeps pagination info in-case limit input was provided */
  pageInfo?: Maybe<PageInfo>;
};

/** Asset details - now always FinP2P */
export type AssetDetails = FinP2PAsset;

export type AssetIssuer = {
  __typename?: 'AssetIssuer';
  assetId: Scalars['String']['output'];
  issuerId: Scalars['String']['output'];
};

export type AssetOrder = {
  __typename?: 'AssetOrder';
  instruction: AssetOrderInstruction;
  term: AssetOrderTerm;
};

export enum AssetOrderField {
  /** Assets order by determined by Name field */
  Name = 'NAME',
  /** Assets order by determined by OrganizationId field */
  Organization = 'ORGANIZATION',
}

export type AssetOrderInput = {
  direction?: InputMaybe<SortOrder>;
  field?: InputMaybe<AssetOrderField>;
};

export type AssetOrderInstruction = {
  __typename?: 'AssetOrderInstruction';
  destinationAccount?: Maybe<LedgerAccountAsset>;
  sourceAccount?: Maybe<LedgerAccountAsset>;
};

export type AssetOrderTerm = {
  __typename?: 'AssetOrderTerm';
  amount: Scalars['String']['output'];
};

export type AssetPolicies = {
  __typename?: 'AssetPolicies';
  proof: ProofPolicy;
};

/** Refresh configuration for an asset's data from a provider */
export type AssetRefreshConfigItem = {
  __typename?: 'AssetRefreshConfigItem';
  createdAt: Scalars['Int']['output'];
  dataType: Scalars['String']['output'];
  enabled: Scalars['Boolean']['output'];
  id: Scalars['String']['output'];
  identifierType: AssetDataIdentifierType;
  identifierValue: Scalars['String']['output'];
  lastRefreshAt?: Maybe<Scalars['Int']['output']>;
  nextRefreshAt?: Maybe<Scalars['Int']['output']>;
  /** UUID of the data provider */
  providerId?: Maybe<Scalars['String']['output']>;
  refreshInterval: Scalars['String']['output'];
  updatedAt: Scalars['Int']['output'];
};

export type AssetTerm = {
  __typename?: 'AssetTerm';
  /** Total amount of asset allocated */
  amount: Scalars['String']['output'];
};

export enum AssetType {
  Cryptocurrency = 'cryptocurrency',
  Fiat = 'fiat',
  Finp2p = 'finp2p',
}

/** Results for asset query. */
export type Assets = {
  __typename?: 'Assets';
  /** Collection of Aggregate Results, if an Aggregate input was provided. */
  aggregate?: Maybe<Array<AggregateResult>>;
  /** Collection of Asset Objects, conforms to the Filter input if provided. */
  nodes?: Maybe<Array<Asset>>;
  /** Keeps pagination info in-case limit input wes provided */
  pageInfo?: Maybe<PageInfo>;
};

export type Attachment = {
  __typename?: 'Attachment';
  link?: Maybe<Scalars['String']['output']>;
  messageId: Scalars['String']['output'];
  name?: Maybe<Scalars['String']['output']>;
  uuid: Scalars['String']['output'];
};

export type AwaitInstruction = {
  __typename?: 'AwaitInstruction';
  /** epoch time for await instruction */
  waitTime: Scalars['Int']['output'];
};

/** Ledger balance sync, completed once its holding record is stored. */
export type BalanceSyncOperation = Operation & {
  __typename?: 'BalanceSyncOperation';
  cid: Scalars['String']['output'];
  completionTimestamp?: Maybe<Scalars['Int']['output']>;
  creationTimestamp?: Maybe<Scalars['Int']['output']>;
  error?: Maybe<OperationError>;
  holdingKey?: Maybe<Scalars['String']['output']>;
  isCompleted: Scalars['Boolean']['output'];
  isFailed: Scalars['Boolean']['output'];
  organizationId?: Maybe<Scalars['String']['output']>;
  status: Scalars['String']['output'];
  type: Scalars['String']['output'];
  workflowIds?: Maybe<Array<Scalars['String']['output']>>;
};

export type BuyingContractDetails = {
  __typename?: 'BuyingContractDetails';
  asset: AssetOrder;
  /** The settlement group this execution actually used. */
  selectedSettlementGroup?: Maybe<BuyingSelectedSettlementGroup>;
  settlement?: Maybe<AssetOrder>;
};

export type BuyingIntent = {
  __typename?: 'BuyingIntent';
  /** Asset term specifies the asset information and amount of the intent */
  assetTerm: AssetTerm;
  /** resource id of the buyer */
  buyer?: Maybe<Scalars['String']['output']>;
  /** Destination account - where buyer receives the asset */
  destination: FinP2PAssetAccount;
  settlementInstruction?: Maybe<BuyingSettlementInstruction>;
  /** Settlement term */
  settlementTerm?: Maybe<SettlementTerm>;
  /** The settlement alternatives declared by this intent; exactly one of them is settled. */
  settlements?: Maybe<Array<BuyingSettlement>>;
  signaturePolicy: BuyingSignaturePolicy;
  /** Signature policy type */
  signaturePolicyType: SignaturePolicyType;
};

/** The settlement group a buying execution actually used, out of the alternatives its intent declared. */
export type BuyingSelectedSettlementGroup = {
  __typename?: 'BuyingSelectedSettlementGroup';
  /** The legs of the selected group; all of them settle together. */
  legs: Array<AssetOrder>;
};

/** One settlement alternative: all of its legs settle together. */
export type BuyingSettlement = {
  __typename?: 'BuyingSettlement';
  legs: Array<BuyingSettlementLeg>;
};

export type BuyingSettlementInstruction = {
  __typename?: 'BuyingSettlementInstruction';
  /** Source account where buyer pays from */
  account?: Maybe<FinP2PAssetAccount>;
};

export type BuyingSettlementLeg = {
  __typename?: 'BuyingSettlementLeg';
  settlementInstruction?: Maybe<BuyingSettlementLegInstruction>;
  settlementTerm?: Maybe<SettlementTerm>;
};

/** The account a buying settlement leg pays from. */
export type BuyingSettlementLegInstruction = {
  __typename?: 'BuyingSettlementLegInstruction';
  sourceAccount?: Maybe<FinP2PAssetAccount>;
};

export type BuyingSignaturePolicy = ManualIntentSignaturePolicy | PresignedBuyingIntentSignaturePolicy;

/** CAIP-10 chain-agnostic on-chain account */
export type Caip10Account = {
  __typename?: 'Caip10Account';
  /** CAIP-10 account address (chain-native address) */
  address: Scalars['String']['output'];
  /** CAIP-2 chain_id, e.g. eip155:1 (the same token used by the CAIP-19 asset identifier network) */
  network: Scalars['String']['output'];
};

/** CAIP-19 format ledger identifier */
export type Caip19Identifier = {
  __typename?: 'Caip19Identifier';
  /** CAIP-2 network identifier (e.g., eip155:1, solana:mainnet) */
  network?: Maybe<Scalars['String']['output']>;
  /** Token standard (e.g., erc20, erc721) */
  standard?: Maybe<Scalars['String']['output']>;
  /** Token ID or contract address */
  tokenId: Scalars['String']['output'];
};

/** Vote to cancel an execution plan, tracked by proposal consensus. */
export type CancelExecutionOperation = Operation & {
  __typename?: 'CancelExecutionOperation';
  cid: Scalars['String']['output'];
  completionTimestamp?: Maybe<Scalars['Int']['output']>;
  creationTimestamp?: Maybe<Scalars['Int']['output']>;
  error?: Maybe<OperationError>;
  /** Same as planId, named to match FinAPI's executionPlanId for client parity. */
  executionPlanId?: Maybe<Scalars['String']['output']>;
  isCompleted: Scalars['Boolean']['output'];
  isFailed: Scalars['Boolean']['output'];
  organizationId?: Maybe<Scalars['String']['output']>;
  planId?: Maybe<Scalars['String']['output']>;
  proposalId?: Maybe<Scalars['String']['output']>;
  status: Scalars['String']['output'];
  type: Scalars['String']['output'];
};

/** Represents a Certificate in the network. */
export type Certificate = {
  __typename?: 'Certificate';
  /** Semi-Structured Data provided as additional information for the Certificate. */
  data?: Maybe<Scalars['String']['output']>;
  /** Certificate associated documents metadata. */
  documents: Documents;
  expiry?: Maybe<Scalars['Int']['output']>;
  id: Scalars['String']['output'];
  issuedAt: Scalars['Int']['output'];
  /** Profile to whom this Certificate is associate with. */
  profileId: Scalars['String']['output'];
  /** Service Provider Id which provided the Certificate. */
  providerId: Scalars['String']['output'];
  /** Type of Certificate (KYA,KYC,AML etc.. ). */
  type: Scalars['String']['output'];
};


/** Represents a Certificate in the network. */
export type CertificateDocumentsArgs = {
  filter?: InputMaybe<Array<Filter>>;
  where?: InputMaybe<FilterExpr>;
};

export type CertificateOrder = {
  direction?: InputMaybe<SortOrder>;
  field?: InputMaybe<CertificateOrderField>;
};

export enum CertificateOrderField {
  /** certificates order by determined by Id field */
  Id = 'ID',
}

/** Results for certificates query. */
export type Certificates = {
  __typename?: 'Certificates';
  /** Collection of Aggregate Results, if an Aggregate input was provided. */
  aggregate?: Maybe<Array<AggregateResult>>;
  /** Collection of Certificate Objects, conforms to the Filter input if provided. */
  nodes?: Maybe<Array<Certificate>>;
  /** Keeps pagination info in-case limit input wes provided */
  pageInfo?: Maybe<PageInfo>;
};

export type CloseAmountRate = {
  __typename?: 'CloseAmountRate';
  repaymentVolume: Scalars['String']['output'];
};

/** One authored container declaration of the provisioning outline (multi-container agreements). */
export type ContainerSpec = {
  __typename?: 'ContainerSpec';
  /** specific investor party this container is bounded to; empty = role-bounded only */
  boundParty: Scalars['String']['output'];
  /** the subset of the agreement's eligible assets this container holds; empty = all of them */
  eligibleAssets: Array<AgreementEligibleAsset>;
  /** stable authoring key; identity across amendments (drives the deterministic policy id) */
  key: Scalars['String']['output'];
  /** override of the spec-level policy template; null = default */
  policyTemplate?: Maybe<AccountPolicy>;
  /** the org of the provisioner role that provisions this container; empty = the role's single party */
  provisionerParty: Scalars['String']['output'];
  /** override of the spec-level provisioner role; empty = default */
  provisionerRole: Scalars['String']['output'];
  /** agreement roles this container serves */
  servesRoles: Array<Scalars['String']['output']>;
};

export type ContractDetails = {
  __typename?: 'ContractDetails';
  additionalContractDetails?: Maybe<AdditionalContractDetails>;
  address: Scalars['String']['output'];
  network: Scalars['String']['output'];
  tokenStandard?: Maybe<Scalars['String']['output']>;
};

export type Correspondent = AssetIssuer;

/** Crypto wallet account */
export type CryptoWalletAccount = {
  __typename?: 'CryptoWalletAccount';
  /** Wallet address represented as a hexadecimal string prefixed with 0x */
  address: Scalars['String']['output'];
};

/** Custodial account reference (e.g. a Fireblocks vault account) that is not a single on-chain address */
export type CustodialAccount = {
  __typename?: 'CustodialAccount';
  /** Optional. Narrows the custodial account to a specific asset/chain. */
  assetId?: Maybe<Scalars['String']['output']>;
  /** Custody provider discriminator, e.g. fireblocks */
  provider: Scalars['String']['output'];
  /** Provider-internal account identifier (e.g. a Fireblocks vault account id) */
  vaultAccountId: Scalars['String']['output'];
};

export type Custodian = {
  __typename?: 'Custodian';
  orgId: Scalars['String']['output'];
};

export type CustodyAccount = {
  __typename?: 'CustodyAccount';
  custodyProvider: Scalars['String']['output'];
  providerAccountId: Scalars['String']['output'];
  publicKey: Scalars['String']['output'];
};

export type CustodyAccounts = {
  __typename?: 'CustodyAccounts';
  nodes?: Maybe<Array<CustodyAccount>>;
  pageInfo?: Maybe<PageInfo>;
};

export type CustodyProvider = {
  __typename?: 'CustodyProvider';
  backoff: Scalars['String']['output'];
  displayName?: Maybe<Scalars['String']['output']>;
  endpoint: Scalars['String']['output'];
  idempotency?: Maybe<LedgerIdempotencyOptions>;
  name: Scalars['String']['output'];
  requestTimeout: Scalars['String']['output'];
  singleRequestTimeout: Scalars['String']['output'];
};

export type CustodyProviders = {
  __typename?: 'CustodyProviders';
  /** Collection of Custody Provider Objects, conforms to the Filter input if provided. */
  nodes?: Maybe<Array<CustodyProvider>>;
  /** Keeps pagination info in-case limit input was provided */
  pageInfo?: Maybe<PageInfo>;
};

export type DataAccess = {
  __typename?: 'DataAccess';
  /** data access type */
  accessType: DataAccessType;
  /** status of the shared resource data access */
  status: Scalars['String']['output'];
  /** organization id the resource shared with */
  targetOrgId: Scalars['String']['output'];
};

export enum DataAccessType {
  Balance = 'Balance',
  Unknown = 'Unknown',
}

/** Represents a data provider binding configuration */
export type DataProviderBinding = {
  __typename?: 'DataProviderBinding';
  backoff: Scalars['String']['output'];
  createdAt: Scalars['Int']['output'];
  /** JSON string of per-data-type fetch configuration */
  dataTypeConfig?: Maybe<Scalars['String']['output']>;
  /** JSON array of data type strings this provider serves */
  dataTypes?: Maybe<Array<Scalars['String']['output']>>;
  displayName?: Maybe<Scalars['String']['output']>;
  endpoint: Scalars['String']['output'];
  /** Unique identifier (UUID) for the data provider */
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  /** Type of data provider: adapter (external HTTP) or finp2p (internal P2P) */
  providerType: Scalars['String']['output'];
  requestTimeout: Scalars['String']['output'];
  updatedAt: Scalars['Int']['output'];
};

/** Results for data provider query. */
export type DataProviderBindings = {
  __typename?: 'DataProviderBindings';
  /** Collection of DataProviderBinding Objects, conforms to the Filter input if provided. */
  nodes?: Maybe<Array<DataProviderBinding>>;
  /** Keeps pagination info in-case limit input was provided */
  pageInfo?: Maybe<PageInfo>;
};

/** Represents a data rule mapping an asset identifier to a data provider */
export type DataRuleItem = {
  __typename?: 'DataRuleItem';
  /** When the rule was created (epoch seconds) */
  createdAt: Scalars['Int']['output'];
  /** The data type this rule covers */
  dataType: Scalars['String']['output'];
  /** Whether this rule is active */
  enabled: Scalars['Boolean']['output'];
  id: Scalars['String']['output'];
  /** Type of identifier (e.g., ISIN) */
  identifierType: Scalars['String']['output'];
  /** The identifier value (e.g., US0378331005) */
  identifierValue: Scalars['String']['output'];
  /** UUID of the data provider */
  providerId: Scalars['String']['output'];
  /** Refresh interval for this rule (e.g., 1h, 24h, RT) */
  refreshInterval?: Maybe<Scalars['String']['output']>;
  /** When the rule was last updated (epoch seconds) */
  updatedAt: Scalars['Int']['output'];
};

/** Results for data rules query. */
export type DataRules = {
  __typename?: 'DataRules';
  /** Collection of DataRuleItem Objects, conforms to the Filter input if provided. */
  nodes?: Maybe<Array<DataRuleItem>>;
  /** Keeps pagination info in-case limit input was provided */
  pageInfo?: Maybe<PageInfo>;
};

/** Financial data types provided by data providers */
export enum DataType {
  AssetHeader = 'assetHeader',
  CorporateActions = 'corporateActions',
  Fundamentals = 'fundamentals',
  MarketData = 'marketData',
  Pricing = 'pricing',
  Ratings = 'ratings',
  ReferenceData = 'referenceData',
}

export type Delivered = {
  __typename?: 'Delivered';
  _ignore?: Maybe<Scalars['Boolean']['output']>;
};

export type DeliveryStatus = Delivered | NotDelivered | PendingDelivery;

/** Deposit instruction request, completed once its receipt (if any) is stored. */
export type DepositOperation = Operation & {
  __typename?: 'DepositOperation';
  cid: Scalars['String']['output'];
  completionTimestamp?: Maybe<Scalars['Int']['output']>;
  creationTimestamp?: Maybe<Scalars['Int']['output']>;
  error?: Maybe<OperationError>;
  isCompleted: Scalars['Boolean']['output'];
  isFailed: Scalars['Boolean']['output'];
  organizationId?: Maybe<Scalars['String']['output']>;
  receiptIds?: Maybe<Array<Scalars['String']['output']>>;
  status: Scalars['String']['output'];
  type: Scalars['String']['output'];
  workflowIds?: Maybe<Array<Scalars['String']['output']>>;
};

/** Certificate related Document metadata informaiton */
export type Document = {
  __typename?: 'Document';
  id: Scalars['String']['output'];
  mimeType: Scalars['String']['output'];
  name: Scalars['String']['output'];
  /** Locaiton of document content. */
  uri: Scalars['String']['output'];
};

/** Results for documents query. */
export type Documents = {
  __typename?: 'Documents';
  /** Collection of Document Objects, conforms to the Filter input if provided. */
  nodes?: Maybe<Array<Document>>;
};

export type Eip712Template = {
  __typename?: 'EIP712Template';
  hash: Scalars['String']['output'];
};

export type ErrorState = {
  __typename?: 'ErrorState';
  code: Scalars['Int']['output'];
  message: Scalars['String']['output'];
};

export type ExecutionContext = {
  __typename?: 'ExecutionContext';
  /** ExecutionPlan associated with the transaction */
  executionPlanId?: Maybe<Scalars['String']['output']>;
  /** The associated instruction sequence number */
  instructionSequenceNumber?: Maybe<Scalars['Int']['output']>;
};

/** Issuance, secondary-market buy/sell, loan, redemption, private offer, request-for-transfer, or move - tracked by its execution plan. */
export type ExecutionOperation = Operation & {
  __typename?: 'ExecutionOperation';
  cid: Scalars['String']['output'];
  completionTimestamp?: Maybe<Scalars['Int']['output']>;
  creationTimestamp?: Maybe<Scalars['Int']['output']>;
  error?: Maybe<OperationError>;
  /** Same as planId, named to match FinAPI's executionOperationResult for client parity. */
  executionPlanId?: Maybe<Scalars['String']['output']>;
  isCompleted: Scalars['Boolean']['output'];
  isFailed: Scalars['Boolean']['output'];
  organizationId?: Maybe<Scalars['String']['output']>;
  planId?: Maybe<Scalars['String']['output']>;
  receiptIds?: Maybe<Array<Scalars['String']['output']>>;
  status: Scalars['String']['output'];
  type: Scalars['String']['output'];
};

/** Information about organization in an Execution Plan context */
export type ExecutionOrganization = {
  __typename?: 'ExecutionOrganization';
  organizationId: Scalars['String']['output'];
  /** Roles this organization holds in the execution plan. An organization with only the observer role is a passive recipient of state updates. */
  roles?: Maybe<Array<ExecutionOrganizationRole>>;
};

/** Role of an organization participating in an Execution Plan */
export enum ExecutionOrganizationRole {
  /** Participates in plan approval and instruction execution */
  Contributor = 'contributor',
  /** Read-only participant; receives state updates but does not approve or execute */
  Observer = 'observer',
}

export type ExecutionPlan = {
  __typename?: 'ExecutionPlan';
  /** list of plan approvals */
  approvals: Array<Maybe<PlanApproval>>;
  /** Resource ids of the assets on the plan's asset leg, both sides, deduplicated and sorted. A move plan can carry two distinct ids. Filterable with CONTAINS only, against one exact, case-sensitive id; use `where`/`or` to match this or `settlementAssetIds`. */
  assetIds: Array<Scalars['String']['output']>;
  /** plan's contract details */
  contract: ExecutionPlanContract;
  /** plan creation (timestamp in sec) */
  creationTimestamp: Scalars['Int']['output'];
  /** Custom key-value metadata for tracing and reconciliation */
  customMetadata?: Maybe<Array<KeyValuePair>>;
  /** resource id of execution plan */
  id: Scalars['String']['output'];
  /** plan's list of instructions */
  instructions: Array<Maybe<ExecutionPlanInstruction>>;
  /** Intent associated with execution plan */
  intent?: Maybe<Intent>;
  /** Resource ids of the plan's investors, deduplicated and sorted. Filterable with CONTAINS only, against one exact, case-sensitive id; use `where`/`or` to match any of several. */
  investorIds: Array<Scalars['String']['output']>;
  /** last time plan was modified (epoch time seconds) */
  lastModified: Scalars['Int']['output'];
  /** organizations which participate in the execution plan */
  organizations: Array<ExecutionOrganization>;
  /** The kind of execution plan, derived from its contract details. Null when the details are missing or of an unrecognized kind. Supports EQ, NEQ and IN. */
  planType?: Maybe<ExecutionPlanType>;
  /** All workflows related to this plan (plan-level and per-instruction) — the top-level `workflows` query pre-scoped to the plan, with the same filter/pagination/ordering. Use pageInfo.totalCount for the count and a filter (e.g. health_status EQ UNHEALTHY) for the problematic subset. Defaults to creationTimestamp ASC. */
  relatedWorkflows: Workflows;
  /** Resource ids of the assets on the plan's settlement leg(s), every leg of a multi-leg settlement included, deduplicated and sorted. Empty for plans that settle nothing. Filterable with CONTAINS only, against one exact, case-sensitive id. */
  settlementAssetIds: Array<Scalars['String']['output']>;
  /** lifecycle status of the execution plan */
  status: ExecutionPlanStatus;
  /** version of the execution plan */
  version: Scalars['Int']['output'];
  /** Plan-level workflows: workflows scoped to the plan itself (e.g. plan_approval, and plan-scoped signature_request) — NOT the per-instruction workflows, which are under instructions.workflows. Fully populated (state, health, availableActions, references, metadata), same as the top-level `workflows` query. */
  workflows: Array<Workflow>;
};


export type ExecutionPlanRelatedWorkflowsArgs = {
  filter?: InputMaybe<Array<Filter>>;
  orderBy?: InputMaybe<WorkflowOrder>;
  paginate?: InputMaybe<PaginateInput>;
  where?: InputMaybe<FilterExpr>;
};

export type ExecutionPlanContract = {
  __typename?: 'ExecutionPlanContract';
  contractDetails?: Maybe<ExecutionPlanContractDetails>;
  investors: Array<ExecutionPlanInvestor>;
};

export type ExecutionPlanContractDetails = BuyingContractDetails | IssuanceContractDetails | LoanContractDetails | MoveContractDetails | PrivateOfferContractDetails | RedemptionContractDetails | RequestForTransferContractDetails | SellingContractDetails | TransferContractDetails;

export type ExecutionPlanInstruction = {
  __typename?: 'ExecutionPlanInstruction';
  approvals: InstructionApprovals;
  details: InstructionDetails;
  organizations: Array<ExecutionOrganization>;
  sequence: Scalars['Int']['output'];
  /** signatures attached to the instruction's operation, empty when the operation carries no signature */
  signatures: Array<InstructionSignature>;
  state: InstructionCompletionState;
  status: ExecutionPlanInstructionStatus;
  transitions: InstructionTransition;
  version: Scalars['Int']['output'];
  workflows: Array<Workflow>;
};


export type ExecutionPlanInstructionApprovalsArgs = {
  filter?: InputMaybe<Array<Filter>>;
};

export enum ExecutionPlanInstructionStatus {
  Approved = 'Approved',
  Cancelled = 'Cancelled',
  Completed = 'Completed',
  Failed = 'Failed',
  Pending = 'Pending',
  Rejected = 'Rejected',
  Unknown = 'Unknown',
}

export type ExecutionPlanInstructions = {
  __typename?: 'ExecutionPlanInstructions';
  nodes?: Maybe<Array<ExecutionPlanInstruction>>;
};

export type ExecutionPlanInvestor = {
  __typename?: 'ExecutionPlanInvestor';
  investor: Scalars['String']['output'];
  role: InvestorRole;
  /** The user record for this investor. Null when this organization has no local record for them, which is normal for a remote participant. */
  user?: Maybe<User>;
};

export type ExecutionPlanOrder = {
  direction?: InputMaybe<SortOrder>;
  field?: InputMaybe<ExecutionPlanOrderField>;
};

export enum ExecutionPlanOrderField {
  CreationTimestamp = 'CREATION_TIMESTAMP',
  /** plan order by PlanId field */
  PlanId = 'PLAN_ID',
}

export enum ExecutionPlanStatus {
  Approved = 'Approved',
  Cancelled = 'Cancelled',
  Completed = 'Completed',
  Failed = 'Failed',
  Halted = 'Halted',
  InProgress = 'InProgress',
  Pending = 'Pending',
  Rejected = 'Rejected',
  Unknown = 'Unknown',
}

/** The kind of execution plan, derived from its contract details. */
export enum ExecutionPlanType {
  Buying = 'BUYING',
  Issuance = 'ISSUANCE',
  Loan = 'LOAN',
  Move = 'MOVE',
  PrivateOffer = 'PRIVATE_OFFER',
  Redemption = 'REDEMPTION',
  RequestForTransfer = 'REQUEST_FOR_TRANSFER',
  Selling = 'SELLING',
  Transfer = 'TRANSFER',
}

export type ExecutionsPlans = {
  __typename?: 'ExecutionsPlans';
  nodes?: Maybe<Array<ExecutionPlan>>;
  /** Keeps pagination info in-case limit input wes provided */
  pageInfo?: Maybe<PageInfo>;
};

/** Fiat currency asset for denomination purposes */
export type FiatAsset = {
  __typename?: 'FiatAsset';
  /** ISO-4217 code of the fiat currency */
  code: Scalars['String']['output'];
};

export type Field = {
  __typename?: 'Field';
  name: Scalars['String']['output'];
  type: Scalars['String']['output'];
  value: Scalars['String']['output'];
};

/**
 * Filter capabilities that can be applied on queries which return multiple results of a given Entity.
 * A filter key names a top-level field of the underlying record, matched case-insensitively. Fields inside
 * a nested object, a union or the elements of a list cannot be filtered on: such a key (e.g.
 * "correspondent.assetId") fails the query. Some collections take keys of their own for a nested
 * value: receipts take executionPlanId and instructionSequenceNumber (the receipt's
 * tradeDetails.executionContext), workflows take health_status (EQ and IN), reference_id and
 * correlation_id (EQ, NEQ and CONTAINS). Multiple filters combine with AND —
 * for boolean combinations (OR, nesting) use the sibling where argument, where offered, taking a FilterExpr.
 */
export type Filter = {
  /**
   * The Object's key to which apply the filter rule: a top-level field of the record.
   * Dot notation addresses only entries of a key-value map field: `labels.<key>` filters on a
   * label, `customMetadata.<key>` on a custom-metadata entry, and the whole remainder of the
   * path is taken as one map key, so a label named `a.b` is addressed as `labels.a.b`.
   * Map keys are matched case-insensitively, like field names: an exact-case key wins, and when
   * several keys differ only in case the lexicographically smallest match is used.
   * A map key that is absent from a record is a non-match for that record — it returns an empty
   * result rather than an error, unlike a key naming no field at all, which fails the query.
   */
  key: Scalars['String']['input'];
  /** Operator to apply on the specified key and provided value. */
  operator: Operator;
  /** The Value to be used by the Filter Operator. */
  value: Scalars['String']['input'];
};

/**
 * Boolean combination of Filters. Exactly one field must be set:
 * filter is a leaf condition; and / or combine sub-expressions.
 * and: [] matches everything; or: [] matches nothing. Maximum nesting depth is 16.
 * When both the filter and where arguments are provided, a record must satisfy both.
 */
export type FilterExpr =
  /** Matches when every sub-expression matches. */
  { and: Array<FilterExpr>; filter?: never; or?: never; }
  |  /** A single leaf condition. */
  { and?: never; filter: Filter; or?: never; }
  |  /** Matches when at least one sub-expression matches. */
  { and?: never; filter?: never; or: Array<FilterExpr>; };

/** FinP2P account - represents a user account in the FinP2P network */
export type FinP2PAccount = {
  __typename?: 'FinP2PAccount';
  /** Account-scoped authorization policy embedded on the account; null for ungoverned accounts */
  accountPolicy?: Maybe<AccountPolicy>;
  /** Custodian for the finId */
  custodian?: Maybe<Custodian>;
  /** FinId -- a user's public key represented as a hexadecimal string */
  finId: Scalars['String']['output'];
  /** Organization id of the account */
  orgId: Scalars['String']['output'];
};

/** FinP2P asset with resource ID and ledger identifier */
export type FinP2PAsset = {
  __typename?: 'FinP2PAsset';
  /** The asset record for this resource id. Null when this organization has no local record for it. */
  asset?: Maybe<Asset>;
  /** Ledger identifier for the asset */
  ledgerIdentifier?: Maybe<LedgerIdentifier>;
  /** Resource ID of the FinP2P asset */
  resourceId: Scalars['String']['output'];
};

/** FinP2P asset account - combines asset info with account info (matches proto FinP2PAssetAccount) */
export type FinP2PAssetAccount = {
  __typename?: 'FinP2PAssetAccount';
  /** FinP2P account information */
  account?: Maybe<FinP2PAccount>;
  /** FinP2P asset information */
  asset?: Maybe<FinP2PAsset>;
};

export type FinP2PevmOperatorDetails = {
  __typename?: 'FinP2PEVMOperatorDetails';
  allowanceRequired: Scalars['Boolean']['output'];
  finP2POperatorContractAddress: Scalars['String']['output'];
};

/** Aggregated view of a financial asset identified by ISIN */
export type FinancialAsset = {
  __typename?: 'FinancialAsset';
  /** CAIP19 identifiers — asset instances on different networks/blockchains (from assetHeader data) */
  caip19Identifiers: Array<Scalars['String']['output']>;
  /** Financial data items from data adapters for this financial identifier */
  dataItems: Array<AssetDataItem>;
  /** Financial identifier type this asset is aggregated by (e.g., ISIN, ISO4217) */
  identifierType: Scalars['String']['output'];
  /** Financial identifier value (e.g., US0378331005 for ISIN, USD for ISO4217) */
  identifierValue: Scalars['String']['output'];
  /** ISIN identifier value (e.g., US0378331005); empty for non-ISIN financial identifiers. Kept for backward compatibility -- prefer identifierType/identifierValue. */
  isin: Scalars['String']['output'];
  /** FinP2P assets linked by matching financial identifier (may be empty) */
  linkedAssets: Array<Asset>;
  /** Refresh configurations for this financial identifier */
  refreshConfigs: Array<AssetRefreshConfigItem>;
};


/** Aggregated view of a financial asset identified by ISIN */
export type FinancialAssetDataItemsArgs = {
  dataTypes?: InputMaybe<Array<DataType>>;
};

/** Results for financial asset query. */
export type FinancialAssets = {
  __typename?: 'FinancialAssets';
  nodes?: Maybe<Array<FinancialAsset>>;
  pageInfo?: Maybe<PageInfo>;
};

export type FinancialIdentifier = {
  __typename?: 'FinancialIdentifier';
  type: FinancialIdentifierType;
  value: Scalars['String']['output'];
};

export enum FinancialIdentifierType {
  Isin = 'ISIN',
  Iso4217 = 'ISO4217',
  None = 'NONE',
  Unspecified = 'UNSPECIFIED',
}

export type FullSettlement = {
  __typename?: 'FullSettlement';
  amount: Scalars['String']['output'];
};

export type HashGroup = {
  __typename?: 'HashGroup';
  fields: Array<Field>;
  hash: Scalars['String']['output'];
};

export type HashlistTemplate = {
  __typename?: 'HashlistTemplate';
  hash: Scalars['String']['output'];
  hashGroups: Array<HashGroup>;
};

export type HoldInstruction = {
  __typename?: 'HoldInstruction';
  /** asset's hold amount */
  amount: Scalars['String']['output'];
  /** destination account information */
  destination?: Maybe<LedgerAccountAsset>;
  /** source account information */
  source: LedgerAccountAsset;
};

export type Holding = {
  __typename?: 'Holding';
  account: FinP2PAccount;
  asset: AssetDetails;
  assetType: AssetType;
  availableBalance: Scalars['String']['output'];
  balance: Scalars['String']['output'];
  balanceTimestamp: Scalars['Int']['output'];
  syncedAvailableBalance: Scalars['String']['output'];
  syncedBalance: Scalars['String']['output'];
  syncedHeldBalance: Scalars['String']['output'];
  withheldBalance: Scalars['String']['output'];
};

/** Fields to subscribe on */
export enum HoldingFields {
  AvailableBalance = 'AvailableBalance',
  Balance = 'Balance',
  SyncedAvailableBalance = 'SyncedAvailableBalance',
  SyncedBalance = 'SyncedBalance',
  SyncedHeldBalance = 'SyncedHeldBalance',
  WithheldBalance = 'WithheldBalance',
}

export type Holdings = {
  __typename?: 'Holdings';
  /** Collection of Aggregate Results, if an Aggregate input was provided. */
  aggregate?: Maybe<Array<AggregateResult>>;
  /** Collection of Funds balance objects, conforms to the Filter input if provided. */
  nodes?: Maybe<Array<Holding>>;
};

export enum HttpSchemas {
  Http1_1 = 'HTTP1_1',
  Http2 = 'HTTP2',
}

/** IBAN bank account */
export type Iban = {
  __typename?: 'Iban';
  /** IBAN code */
  code: Scalars['String']['output'];
};

export type IncomingMessage = {
  __typename?: 'IncomingMessage';
  message?: Maybe<Message>;
};

export type InstructionApproval = {
  __typename?: 'InstructionApproval';
  orgId: Scalars['String']['output'];
  planId: Scalars['String']['output'];
  reason: Scalars['String']['output'];
  sequence: Scalars['Int']['output'];
  status: Scalars['String']['output'];
};

/** Results for Instruction Approval query. */
export type InstructionApprovals = {
  __typename?: 'InstructionApprovals';
  /** Collection of Aggregate Results, if an Aggregate input was provided. */
  aggregate?: Maybe<Array<AggregateResult>>;
  /** Collection of Instruction Approval Objects, conforms to the Filter input if provided. */
  nodes?: Maybe<Array<InstructionApproval>>;
};

export type InstructionCompletionState = ErrorState | SuccessState | UnknownState;

export type InstructionDetails = AwaitInstruction | HoldInstruction | IssueInstruction | MoveInstruction | RedeemInstruction | ReleaseInstruction | RevertHoldInstruction | SwapInstruction | TransferInstruction;

/**
 * The receipts of one instruction that attested MORE than one movement. Named InstructionReceipts
 * because `Receipts` is already the paginated receipt-query result.
 */
export type InstructionReceipts = {
  __typename?: 'InstructionReceipts';
  receipts: Array<Receipt>;
};

/** Signature attached to an execution plan instruction operation */
export type InstructionSignature = {
  __typename?: 'InstructionSignature';
  signature: InstructionSignatureData;
};

export type InstructionSignatureData = {
  __typename?: 'InstructionSignatureData';
  /** hash function used by the signature template (e.g. sha3-256, keccak-256, blake2b) */
  hashFunction: Scalars['String']['output'];
  /** hex-encoded public key the operation is signed with (signer's finId) */
  publicKey: Scalars['String']['output'];
  /** hex-encoded signature payload */
  signature: Scalars['String']['output'];
  /** signature template type (e.g. HashListTemplate, EIP712Template) */
  templateType: Scalars['String']['output'];
};

export type InstructionTransition = {
  __typename?: 'InstructionTransition';
  onFailure?: Maybe<Transition>;
  onSuccess?: Maybe<Transition>;
  onTimeout?: Maybe<Transition>;
};

/** Represent an Asset's Transaction Intent occasion in which the Asset's tokens are issued. */
export type Intent = {
  __typename?: 'Intent';
  /** Custom key-value metadata for tracing and reconciliation */
  customMetadata?: Maybe<Array<KeyValuePair>>;
  /** End time of the intent. */
  end: Scalars['Int']['output'];
  id: Scalars['String']['output'];
  /** Intent data */
  intent?: Maybe<IntentDetails>;
  /** Profile metadata, contains ACL information of the profile. */
  metadata: ProfileMetadata;
  /** Reason the intent was rejected, prefixed with the rejecting organization (owner side only). */
  rejectReason?: Maybe<Scalars['String']['output']>;
  /** Remaining quantity in the transaction. */
  remainingQuantity: Scalars['String']['output'];
  /** Start time of the intent. */
  start: Scalars['Int']['output'];
  /** Intent status */
  status: IntentStatus;
  /** Intent type: primary sale, buying or selling intent */
  type: Scalars['String']['output'];
  /** intent resource version */
  version: Scalars['String']['output'];
};

export type IntentDetails = BuyingIntent | LoanIntent | MoveIntent | PrimarySale | PrivateOfferIntent | RedemptionIntent | RequestForTransferIntent | SellingIntent;

/** Fields to subscribe on */
export enum IntentField {
  RemainingQuantity = 'RemainingQuantity',
  Status = 'Status',
}

export enum IntentStatus {
  Active = 'ACTIVE',
  Cancelled = 'CANCELLED',
  Completed = 'COMPLETED',
  Expired = 'EXPIRED',
  NonActive = 'NON_ACTIVE',
  Rejected = 'REJECTED',
}

export enum IntentTypes {
  Buying = 'BUYING',
  Loan = 'LOAN',
  Move = 'MOVE',
  PrimarySale = 'PRIMARY_SALE',
  PrivateOffer = 'PRIVATE_OFFER',
  Redemption = 'REDEMPTION',
  RequestForTransfer = 'REQUEST_FOR_TRANSFER',
  Selling = 'SELLING',
}

/** Results for itents query. */
export type Intents = {
  __typename?: 'Intents';
  /** Collection of Aggregate Results, if an Aggregate input was provided. */
  aggregate?: Maybe<Array<AggregateResult>>;
  /** Collection of Intent Objects, conforms to the Filter input if provided. */
  nodes?: Maybe<Array<Intent>>;
};

export type InterestRate = {
  __typename?: 'InterestRate';
  annualPercentageRate: Scalars['String']['output'];
};

export type Investor = {
  __typename?: 'Investor';
  resourceId: Scalars['String']['output'];
};

/** An investor's LA-managed network account bound to a specific organization and asset. */
export type InvestorNetworkAccount = {
  __typename?: 'InvestorNetworkAccount';
  /** The bound network identity — a union of variants (wallet today; caip10/custodial when projected). Exactly one variant is set. */
  account?: Maybe<NetworkAccount>;
  /** Asset the network account is bound to. */
  assetId: Scalars['String']['output'];
  /** LA-assigned account identifier. */
  id: Scalars['String']['output'];
  /** Organization that manages this network account. */
  organizationId: Scalars['String']['output'];
};

export enum InvestorRole {
  Borrower = 'BORROWER',
  Buyer = 'BUYER',
  Issuer = 'ISSUER',
  Lender = 'LENDER',
  Seller = 'SELLER',
}

export type IssuanceContractDetails = {
  __typename?: 'IssuanceContractDetails';
  asset: AssetOrder;
  settlement?: Maybe<AssetOrder>;
};

export type IssueInstruction = {
  __typename?: 'IssueInstruction';
  /** asset's issuance amount */
  amount: Scalars['String']['output'];
  /** destination account for issuance */
  destination: LedgerAccountAsset;
  /** source for issuance */
  source?: Maybe<LedgerAccountAsset>;
};

/** Represents an Issuer in the network. */
export type Issuer = {
  __typename?: 'Issuer';
  /** Assets issued by the Issuer. */
  assets: Assets;
  id: Scalars['String']['output'];
  outbox?: Maybe<OutgoingMessages>;
};


/** Represents an Issuer in the network. */
export type IssuerAssetsArgs = {
  aggregates?: InputMaybe<Array<Aggregate>>;
  filter?: InputMaybe<Array<Filter>>;
  paginate?: InputMaybe<PaginateInput>;
  where?: InputMaybe<FilterExpr>;
};


/** Represents an Issuer in the network. */
export type IssuerOutboxArgs = {
  filter?: InputMaybe<Array<Filter>>;
  where?: InputMaybe<FilterExpr>;
};

export type IssuerOrder = {
  direction?: InputMaybe<SortOrder>;
  field?: InputMaybe<IssuerOrderField>;
};

export enum IssuerOrderField {
  /** issuers order by determined by Id field */
  Id = 'ID',
}

/** Results for issuers query. */
export type Issuers = {
  __typename?: 'Issuers';
  /** Collection of Issuer Objects, conforms to the Filter input if provided. */
  nodes?: Maybe<Array<Issuer>>;
  /** Keeps pagination info in-case limit input wes provided */
  pageInfo?: Maybe<PageInfo>;
};

export type KeyValuePair = {
  __typename?: 'KeyValuePair';
  key: Scalars['String']['output'];
  value: Scalars['String']['output'];
};

/** Ledger account asset - combines FinP2P account with optional network account */
export type LedgerAccountAsset = {
  __typename?: 'LedgerAccountAsset';
  /** FinP2P asset account */
  finp2pAccount: FinP2PAssetAccount;
  /** Network account (e.g., wallet) */
  networkAccount?: Maybe<NetworkAccount>;
};

export type LedgerApiKeyOptions = {
  __typename?: 'LedgerApiKeyOptions';
  apiKey: Scalars['String']['output'];
};

export type LedgerAssetInfo = {
  __typename?: 'LedgerAssetInfo';
  ledgerBinding?: Maybe<LedgerBinding>;
  ledgerIdentifier?: Maybe<LedgerIdentifier>;
  ledgerReference?: Maybe<LedgerReference>;
};

export type LedgerAuthOptions = LedgerApiKeyOptions | LedgerMtlsOptions | LedgerOAuthOptions;

export enum LedgerAuthType {
  ApiKey = 'API_KEY',
  Mtls = 'MTLS',
  Oauth = 'OAUTH',
}

export type LedgerBinding = {
  __typename?: 'LedgerBinding';
  backoff: Scalars['String']['output'];
  balanceSyncAllowed: Scalars['Boolean']['output'];
  displayName?: Maybe<Scalars['String']['output']>;
  endpoint: Scalars['String']['output'];
  idempotency?: Maybe<LedgerIdempotencyOptions>;
  name: Scalars['String']['output'];
  requestTimeout: Scalars['String']['output'];
  singleRequestTimeout: Scalars['String']['output'];
};

export type LedgerBindings = {
  __typename?: 'LedgerBindings';
  /** Collection of Ledger Binding Objects, conforms to the Filter input if provided. */
  nodes?: Maybe<Array<LedgerBinding>>;
  /** Keeps pagination info in-case limit input wes provided */
  pageInfo?: Maybe<PageInfo>;
};

export type LedgerIdempotencyOptions = {
  __typename?: 'LedgerIdempotencyOptions';
  idempotent: Scalars['Boolean']['output'];
  transientFailureCodes: Array<Scalars['String']['output']>;
};

/** Ledger identifier union - currently only CAIP-19 supported */
export type LedgerIdentifier = Caip19Identifier;

export type LedgerMtlsOptions = {
  __typename?: 'LedgerMtlsOptions';
  caCertificate: Scalars['String']['output'];
  clientCertificate: Scalars['String']['output'];
  key: Scalars['String']['output'];
};

export type LedgerOAuthOptions = {
  __typename?: 'LedgerOAuthOptions';
  alg: Scalars['String']['output'];
  jwtKey: Scalars['String']['output'];
  oauthClientId: Scalars['String']['output'];
  oauthClientSecret: Scalars['String']['output'];
  oauthServerEndpoint: Scalars['String']['output'];
};

export type LedgerReference = ContractDetails;

export type LoanConditions = CloseAmountRate | InterestRate | RepaymentTerm;

export type LoanContractDetails = {
  __typename?: 'LoanContractDetails';
  asset: LoanOrder;
  instruction?: Maybe<LoanInstruction>;
  settlement?: Maybe<LoanOrder>;
};

export type LoanInstruction = {
  __typename?: 'LoanInstruction';
  closeDate: Scalars['Int']['output'];
  loanConditions: LoanConditions;
  openDate: Scalars['Int']['output'];
};

export type LoanIntent = {
  __typename?: 'LoanIntent';
  /** Asset term specifies the asset information and amount of the intent */
  assetTerm: AssetTerm;
  /** resource id of the borrower */
  borrower: Scalars['String']['output'];
  /** Borrower's account for the loan asset */
  borrowerAccount: FinP2PAssetAccount;
  /** resource id of the lender */
  lender: Scalars['String']['output'];
  /** Lender's account for the loan asset */
  lenderAccount: FinP2PAssetAccount;
  loanInstruction: LoanInstruction;
  /** Signature policy type */
  loanSettlementInstruction?: Maybe<LoanSettlementInstruction>;
  /** Settlement term */
  settlementTerm?: Maybe<SettlementTerm>;
  signaturePolicy: LoanSignaturePolicy;
  signaturePolicyType: SignaturePolicyType;
};

export type LoanOrder = {
  __typename?: 'LoanOrder';
  instruction: LoanOrderInstruction;
  term: AssetOrderTerm;
};

export type LoanOrderInstruction = {
  __typename?: 'LoanOrderInstruction';
  borrowerAccount?: Maybe<LedgerAccountAsset>;
  lenderAccount?: Maybe<LedgerAccountAsset>;
};

export type LoanSettlementInstruction = {
  __typename?: 'LoanSettlementInstruction';
  /** Borrower's account for settlement */
  borrowerAccount?: Maybe<FinP2PAssetAccount>;
  /** Lender's account for settlement */
  lenderAccount?: Maybe<FinP2PAssetAccount>;
};

export type LoanSignaturePolicy = PresignedLoanIntentSignaturePolicy;

export type ManualIntentSignaturePolicy = {
  __typename?: 'ManualIntentSignaturePolicy';
  _ignore?: Maybe<Scalars['Boolean']['output']>;
};

export type Message = {
  __typename?: 'Message';
  attachments: Array<Attachment>;
  body: Scalars['String']['output'];
  correspondent: Correspondent;
  id: Scalars['String']['output'];
  subject: Scalars['String']['output'];
  timestamp: Scalars['String']['output'];
};

export type MessageRecipient = {
  __typename?: 'MessageRecipient';
  deliveryStatus?: Maybe<DeliveryStatus>;
  destination: Recipient;
};

export type MessageRecipients = {
  __typename?: 'MessageRecipients';
  /** Collection of User Objects, conforms to the Filter input if provided. */
  nodes?: Maybe<Array<MessageRecipient>>;
};

export type Messages = {
  __typename?: 'Messages';
  nodes?: Maybe<Array<Message>>;
};

export type MoveContractDetails = {
  __typename?: 'MoveContractDetails';
  asset: AssetOrder;
};

/** A Move destination asset. Superset of FinP2PAsset (same resourceId + ledgerIdentifier), plus an optional pre-funded pool the Transfer drains into the destination for the hold-transfer-* variants. */
export type MoveDestination = {
  __typename?: 'MoveDestination';
  /** Optional pre-funded pool account drained into this destination by the hold-transfer-* variants (null otherwise) */
  fromSegregatedAccount?: Maybe<FinP2PAccount>;
  /** Ledger identifier for the destination asset */
  ledgerIdentifier?: Maybe<LedgerIdentifier>;
  /** Resource ID of the destination FinP2P asset */
  resourceId: Scalars['String']['output'];
};

export type MoveInstruction = {
  __typename?: 'MoveInstruction';
  /** asset's move amount */
  amount: Scalars['String']['output'];
  /** destination account information */
  destination: LedgerAccountAsset;
  /** source account information */
  source: LedgerAccountAsset;
};

export type MoveIntent = {
  __typename?: 'MoveIntent';
  /** Allowed destination assets of the migration path (the executor picks one at execution) */
  destinationAssets?: Maybe<Array<MoveDestination>>;
  signaturePolicy: MoveSignaturePolicy;
  /** Signature policy type */
  signaturePolicyType: SignaturePolicyType;
  /** Source asset of the migration path (resourceId + ledgerIdentifier; accounts are supplied per-owner at execution) */
  sourceAsset?: Maybe<FinP2PAsset>;
  /** Optional segregated account that receives released source tokens for the hold-*-release variants (instead of burning via Redeem) */
  sourceToSegregatedAccount?: Maybe<FinP2PAccount>;
};

export type MoveSignaturePolicy = ManualIntentSignaturePolicy | PresignedMoveIntentSignaturePolicy;

/** Network account — exactly one variant, mirroring the proto NetworkAccount oneof. */
export type NetworkAccount = Caip10Account | CustodialAccount | WalletAccount;

export type NoProof = {
  __typename?: 'NoProof';
  _ignore?: Maybe<Scalars['Boolean']['output']>;
};

export type NoProofPolicy = {
  __typename?: 'NoProofPolicy';
  _ignore?: Maybe<Scalars['Boolean']['output']>;
};

export type NoSettlement = {
  __typename?: 'NoSettlement';
  _ignore?: Maybe<Scalars['Boolean']['output']>;
};

export type NodeAddress = {
  __typename?: 'NodeAddress';
  /** address value */
  address: Scalars['String']['output'];
  /** node port */
  port: Scalars['Int']['output'];
  /** supported http schemas */
  schemas: Array<HttpSchemas>;
};

export type NotDelivered = {
  __typename?: 'NotDelivered';
  status: Scalars['String']['output'];
};

/** A FinAPI operation, keyed by its correlation id (cid). isCompleted is only true once every side-effect entity listed on this record is already queryable in this OSS instance. Mirrors finp2p-core's operationResponse oneOf/discriminator shape (api/application-api.base.yaml) - one concrete type per FinAPI operation kind, holding only the side-effect ids that kind actually projects. */
export type Operation = {
  cid: Scalars['String']['output'];
  completionTimestamp?: Maybe<Scalars['Int']['output']>;
  creationTimestamp?: Maybe<Scalars['Int']['output']>;
  error?: Maybe<OperationError>;
  isCompleted: Scalars['Boolean']['output'];
  isFailed: Scalars['Boolean']['output'];
  organizationId?: Maybe<Scalars['String']['output']>;
  /** Owning service status, verbatim from finp2p-core. */
  status: Scalars['String']['output'];
  /** One of: token profile deposit withdraw execution cancel-execution reset-execution account workflow balance-sync */
  type: Scalars['String']['output'];
};

export type OperationError = {
  __typename?: 'OperationError';
  code: Scalars['Int']['output'];
  message: Scalars['String']['output'];
};

/** Fields to subscribe on */
export enum OperationField {
  IsCompleted = 'IsCompleted',
  IsFailed = 'IsFailed',
  Status = 'Status',
}

export type OperationOrder = {
  direction?: InputMaybe<SortOrder>;
  field?: InputMaybe<OperationOrderField>;
};

export enum OperationOrderField {
  Cid = 'CID',
  CompletionTimestamp = 'COMPLETION_TIMESTAMP',
  CreationTimestamp = 'CREATION_TIMESTAMP',
  Status = 'STATUS',
  Type = 'TYPE',
}

export enum OperationType {
  Hold = 'Hold',
  Issue = 'Issue',
  Move = 'Move',
  Redeem = 'Redeem',
  Release = 'Release',
  Swap = 'Swap',
  Transfer = 'Transfer',
  Unknown = 'Unknown',
}

export type Operations = {
  __typename?: 'Operations';
  /** Collection of Operation Objects, conforms to the Filter input if provided. */
  nodes?: Maybe<Array<Operation>>;
  /** Keeps pagination info in-case limit input was provided */
  pageInfo?: Maybe<PageInfo>;
};

/** Operators available to be used  */
export enum Operator {
  /** Contains. On a String field: case-insensitive substring match. On a list field: exact element membership, except the workflow correlation_id and reference_id filters, which match a case-insensitive substring within each element. */
  Contains = 'CONTAINS',
  /** Equals */
  Eq = 'EQ',
  /** Greater Than */
  Gt = 'GT',
  /** Greater Than or Equals */
  Gte = 'GTE',
  /** In */
  In = 'IN',
  /** Less Than */
  Lt = 'LT',
  /** Less Than or Equals */
  Lte = 'LTE',
  /** Not Equals */
  Neq = 'NEQ',
  /** Not In */
  Nin = 'NIN',
}

/** Organization's information. */
export type Organization = {
  __typename?: 'Organization';
  /** Assets which the Organization act as the Primary Node. */
  assets: Assets;
  /** Organization's cluster id. */
  clusterId: Scalars['String']['output'];
  /** Organization's finp2p public key represented as a hexadecimal string. */
  finId: Scalars['String']['output'];
  id: Scalars['String']['output'];
  /** Organization's name on the finp2p network. */
  name: Scalars['String']['output'];
  /** Organization's supported types, e.g. Primary, Escrow */
  types?: Maybe<Array<Scalars['String']['output']>>;
  /** Users which the Organization act as the Primary Node. */
  users: Users;
};


/** Organization's information. */
export type OrganizationAssetsArgs = {
  aggregates?: InputMaybe<Array<Aggregate>>;
  filter?: InputMaybe<Array<Filter>>;
  paginate?: InputMaybe<PaginateInput>;
  where?: InputMaybe<FilterExpr>;
};


/** Organization's information. */
export type OrganizationUsersArgs = {
  aggregates?: InputMaybe<Array<Aggregate>>;
  filter?: InputMaybe<Array<Filter>>;
  paginate?: InputMaybe<PaginateInput>;
  where?: InputMaybe<FilterExpr>;
};

export type OrganizationAsset = {
  __typename?: 'OrganizationAsset';
  asset: Asset;
  metadata: ProfileMetadata;
};

export type OrganizationOrder = {
  direction?: InputMaybe<SortOrder>;
  field?: InputMaybe<OrganizationOrderField>;
};

export enum OrganizationOrderField {
  /** organizations order by determined by Id field */
  Id = 'ID',
}

/** Results for Organization query. */
export type Organizations = {
  __typename?: 'Organizations';
  /** Collection of Aggregate Results, if an Aggregate input was provided. */
  aggregate?: Maybe<Array<AggregateResult>>;
  /** Collection of Organization Objects, conforms to the Filter input if provided. */
  nodes?: Maybe<Array<Organization>>;
  /** Keeps pagination info in-case limit input wes provided */
  pageInfo?: Maybe<PageInfo>;
};

export type OutgoingMessage = {
  __typename?: 'OutgoingMessage';
  message?: Maybe<Message>;
  recipients: MessageRecipients;
};


export type OutgoingMessageRecipientsArgs = {
  filter?: InputMaybe<Array<Filter>>;
};

export type OutgoingMessages = {
  __typename?: 'OutgoingMessages';
  nodes?: Maybe<Array<OutgoingMessage>>;
};

export type PageInfo = {
  __typename?: 'PageInfo';
  /** Cursor for the end of the current page */
  endCursor?: Maybe<Scalars['String']['output']>;
  /** Indicates if there are more items after the current page */
  hasNextPage: Scalars['Boolean']['output'];
  /** Total count of items */
  totalCount: Scalars['Int']['output'];
  /** Total count of items left to be presented */
  totalLeft: Scalars['Int']['output'];
};

export type PaginateInput = {
  /** Cursor field to return records after it */
  after?: InputMaybe<Scalars['String']['input']>;
  /** Number of records to return in response */
  limit?: InputMaybe<Scalars['Int']['input']>;
  /** Number of pages to skip to get new cursor */
  skip?: InputMaybe<Scalars['Int']['input']>;
};

export type PartialSettlement = {
  __typename?: 'PartialSettlement';
  unitValue: Scalars['String']['output'];
};

export type PendingDelivery = {
  __typename?: 'PendingDelivery';
  _ignore?: Maybe<Scalars['Boolean']['output']>;
};

export type PinningConfig = {
  __typename?: 'PinningConfig';
  /** pinning config unique id */
  id: Scalars['String']['output'];
  /** pinning service configuration data */
  nodes: Array<PinningConfigNodeEntry>;
};

export type PinningConfigNodeEntry = {
  __typename?: 'PinningConfigNodeEntry';
  addresses: Array<NodeAddress>;
  /** entry unique id */
  id: Scalars['String']['output'];
  token: Scalars['String']['output'];
};

export type PinningConfigs = {
  __typename?: 'PinningConfigs';
  /** pinning service configuration data */
  nodes?: Maybe<Array<PinningConfig>>;
};

export type PlanApproval = {
  __typename?: 'PlanApproval';
  orgId: Scalars['String']['output'];
  planId: Scalars['String']['output'];
  status: ApprovalStatus;
  statusInfo: PlanApprovalStatusInfo;
};

export type PlanApprovalStatusInfo = {
  __typename?: 'PlanApprovalStatusInfo';
  code: Scalars['Int']['output'];
  message: Scalars['String']['output'];
};

/** Results for Plan Approval query. */
export type PlanApprovals = {
  __typename?: 'PlanApprovals';
  /** Collection of Aggregate Results, if an Aggregate input was provided. */
  aggregate?: Maybe<Array<AggregateResult>>;
  /** Collection of Plan Approval Objects, conforms to the Filter input if provided. */
  nodes?: Maybe<Array<PlanApproval>>;
};

/** Fields to subscribe on */
export enum PlanField {
  Status = 'Status',
}

export type PresignedBuyingIntentSignaturePolicy = {
  __typename?: 'PresignedBuyingIntentSignaturePolicy';
  _ignore?: Maybe<Scalars['Boolean']['output']>;
};

export type PresignedLoanIntentSignaturePolicy = {
  __typename?: 'PresignedLoanIntentSignaturePolicy';
  _ignore?: Maybe<Scalars['Boolean']['output']>;
};

export type PresignedMoveIntentSignaturePolicy = {
  __typename?: 'PresignedMoveIntentSignaturePolicy';
  _ignore?: Maybe<Scalars['Boolean']['output']>;
};

export type PresignedPrivateOfferIntentSignaturePolicy = {
  __typename?: 'PresignedPrivateOfferIntentSignaturePolicy';
  _ignore?: Maybe<Scalars['Boolean']['output']>;
};

export type PresignedRedemptionIntentSignaturePolicy = {
  __typename?: 'PresignedRedemptionIntentSignaturePolicy';
  _ignore?: Maybe<Scalars['Boolean']['output']>;
};

export type PresignedRequestForTransferIntentSignaturePolicy = {
  __typename?: 'PresignedRequestForTransferIntentSignaturePolicy';
  _ignore?: Maybe<Scalars['Boolean']['output']>;
};

export type PresignedSellingIntentSignaturePolicy = {
  __typename?: 'PresignedSellingIntentSignaturePolicy';
  _ignore?: Maybe<Scalars['Boolean']['output']>;
};

export type PrimarySale = {
  __typename?: 'PrimarySale';
  /** Asset term specifies the asset information and amount of the intent */
  assetTerm: AssetTerm;
  /** Issuer id */
  issuerId: Scalars['String']['output'];
  sellingSettlementInstruction?: Maybe<SellingSettlementInstruction>;
  /** Settlement term */
  settlementTerm?: Maybe<SettlementTerm>;
  /** Source account - issuer's account from which asset is sold */
  source: FinP2PAssetAccount;
};

export type PrivateOfferContractDetails = {
  __typename?: 'PrivateOfferContractDetails';
  asset: AssetOrder;
  /** The settlement group this execution actually used. */
  selectedSettlementGroup?: Maybe<PrivateOfferSelectedSettlementGroup>;
  settlement?: Maybe<AssetOrder>;
};

export type PrivateOfferIntent = {
  __typename?: 'PrivateOfferIntent';
  /** Asset term specifies the asset information and amount of the intent */
  assetTerm: AssetTerm;
  /** resource id of the buyer */
  buyer?: Maybe<Scalars['String']['output']>;
  /** resource id of the seller */
  seller?: Maybe<Scalars['String']['output']>;
  sellingSettlementInstruction?: Maybe<SellingSettlementInstruction>;
  /** Settlement term */
  settlementTerm?: Maybe<SettlementTerm>;
  /** The settlement alternatives declared by this intent; exactly one of them is settled. */
  settlements?: Maybe<Array<PrivateOfferSettlement>>;
  signaturePolicy: PrivateOfferSignaturePolicy;
  /** Signature policy type */
  signaturePolicyType: SignaturePolicyType;
  /** Source account - seller's account from which asset is sold */
  source: FinP2PAssetAccount;
};

/** The settlement group a private-offer execution actually used, out of the alternatives its intent declared. */
export type PrivateOfferSelectedSettlementGroup = {
  __typename?: 'PrivateOfferSelectedSettlementGroup';
  /** The legs of the selected group; all of them settle together. */
  legs: Array<AssetOrder>;
};

/** One settlement alternative: all of its legs settle together. */
export type PrivateOfferSettlement = {
  __typename?: 'PrivateOfferSettlement';
  legs: Array<PrivateOfferSettlementLeg>;
};

export type PrivateOfferSettlementLeg = {
  __typename?: 'PrivateOfferSettlementLeg';
  settlementInstruction?: Maybe<PrivateOfferSettlementLegInstruction>;
  settlementTerm?: Maybe<SettlementTerm>;
};

export type PrivateOfferSettlementLegInstruction = {
  __typename?: 'PrivateOfferSettlementLegInstruction';
  destinationAccount?: Maybe<FinP2PAssetAccount>;
};

export type PrivateOfferSignaturePolicy = ManualIntentSignaturePolicy | PresignedPrivateOfferIntentSignaturePolicy;

/** Profile interface. */
export type Profile = {
  /** Collection of certificates associated with the Profile. */
  certificates: Certificates;
  id: Scalars['String']['output'];
  /** Profile metadata, contains ACL information of the profile. */
  metadata: ProfileMetadata;
  /** Organization id to which this profile is associated with. */
  organizationId: Scalars['String']['output'];
};


/** Profile interface. */
export type ProfileCertificatesArgs = {
  aggregates?: InputMaybe<Array<Aggregate>>;
  filter?: InputMaybe<Array<Filter>>;
  where?: InputMaybe<FilterExpr>;
};

/** Profile Metadata (ACL). */
export type ProfileMetadata = {
  __typename?: 'ProfileMetadata';
  acl?: Maybe<Array<Scalars['String']['output']>>;
  /** Shared resources data access given to which org */
  dataAccess?: Maybe<Array<DataAccess>>;
};

/** Asset or user profile creation. */
export type ProfileOperation = Operation & {
  __typename?: 'ProfileOperation';
  assetId?: Maybe<Scalars['String']['output']>;
  cid: Scalars['String']['output'];
  completionTimestamp?: Maybe<Scalars['Int']['output']>;
  creationTimestamp?: Maybe<Scalars['Int']['output']>;
  error?: Maybe<OperationError>;
  isCompleted: Scalars['Boolean']['output'];
  isFailed: Scalars['Boolean']['output'];
  organizationId?: Maybe<Scalars['String']['output']>;
  status: Scalars['String']['output'];
  type: Scalars['String']['output'];
  workflowIds?: Maybe<Array<Scalars['String']['output']>>;
};

export type Proof = NoProof | SignatureProof;

export type ProofPolicy = NoProofPolicy | SignatureProofPolicy;

/** The query root of Ownera's GraphQL interface. */
export type Query = {
  __typename?: 'Query';
  /** Look up agreement container accounts across all agreements (the accounts registry view). Filter by agreementId or finId. */
  agreementAccounts: AgreementAccounts;
  /** Look up Agreements (resource type 107), Optional provide Filter. Ordered by id unless orderBy says otherwise. */
  agreements: Agreements;
  approvalConfigs: ApprovalConfigs;
  /** Look up Asset Data, Optional provide Filter. */
  assetDatas: AssetDatas;
  /** Look up Assets, Optional provide Filters or Aggregates. */
  assets: Assets;
  /** Look up Certificates, Optional provide Filter or Aggregate. */
  certificates: Certificates;
  /** Look up custody provider accounts. */
  custodyAccounts: CustodyAccounts;
  custodyProviders: CustodyProviders;
  /** Look up Data Provider bindings. */
  dataProviders: DataProviderBindings;
  /** Look up Data Rules that map identifiers to data providers. */
  dataRules: DataRules;
  /** Look up FinancialAssets aggregated by financial identifier (type + value) from data adapter data. Filter by identifierType/identifierValue to get a specific asset. */
  financialAssets: FinancialAssets;
  /** Look up Issuers, Optional provide Filter. */
  issuers: Issuers;
  ledgers: LedgerBindings;
  /** Look up FinAPI Operations. Lookup by cid: filter: [{key:"cid", operator: EQ, value: "<cid>"}]. */
  operations: Operations;
  /** Look up Organizations, Optional provide Filter or Aggregate. */
  organizations: Organizations;
  pinningConfig?: Maybe<PinningConfigs>;
  /** Look up Execution Plans, Optional provide Filter. */
  plans: ExecutionsPlans;
  /** Look up Receipts, Optional provide Filter. */
  receipts: Receipts;
  /** Look up Users, Optional provide Filter or Aggregate. */
  users: Users;
  /** Look up Workflows, Optional provide Filter. */
  workflows: Workflows;
};


/** The query root of Ownera's GraphQL interface. */
export type QueryAgreementAccountsArgs = {
  filter?: InputMaybe<Array<Filter>>;
  paginate?: InputMaybe<PaginateInput>;
};


/** The query root of Ownera's GraphQL interface. */
export type QueryAgreementsArgs = {
  filter?: InputMaybe<Array<Filter>>;
  orderBy?: InputMaybe<AgreementOrder>;
  paginate?: InputMaybe<PaginateInput>;
};


/** The query root of Ownera's GraphQL interface. */
export type QueryApprovalConfigsArgs = {
  paginate?: InputMaybe<PaginateInput>;
};


/** The query root of Ownera's GraphQL interface. */
export type QueryAssetDatasArgs = {
  filter?: InputMaybe<Array<Filter>>;
  paginate?: InputMaybe<PaginateInput>;
  where?: InputMaybe<FilterExpr>;
};


/** The query root of Ownera's GraphQL interface. */
export type QueryAssetsArgs = {
  aggregate?: InputMaybe<Array<Aggregate>>;
  filter?: InputMaybe<Array<Filter>>;
  orderBy?: InputMaybe<AssetOrderInput>;
  paginate?: InputMaybe<PaginateInput>;
  where?: InputMaybe<FilterExpr>;
};


/** The query root of Ownera's GraphQL interface. */
export type QueryCertificatesArgs = {
  aggregate?: InputMaybe<Array<Aggregate>>;
  filter?: InputMaybe<Array<Filter>>;
  orderBy?: InputMaybe<CertificateOrder>;
  paginate?: InputMaybe<PaginateInput>;
  where?: InputMaybe<FilterExpr>;
};


/** The query root of Ownera's GraphQL interface. */
export type QueryCustodyAccountsArgs = {
  filter?: InputMaybe<Array<Filter>>;
  paginate?: InputMaybe<PaginateInput>;
  where?: InputMaybe<FilterExpr>;
};


/** The query root of Ownera's GraphQL interface. */
export type QueryCustodyProvidersArgs = {
  filter?: InputMaybe<Array<Filter>>;
  paginate?: InputMaybe<PaginateInput>;
  where?: InputMaybe<FilterExpr>;
};


/** The query root of Ownera's GraphQL interface. */
export type QueryDataProvidersArgs = {
  filter?: InputMaybe<Array<Filter>>;
  paginate?: InputMaybe<PaginateInput>;
  where?: InputMaybe<FilterExpr>;
};


/** The query root of Ownera's GraphQL interface. */
export type QueryDataRulesArgs = {
  filter?: InputMaybe<Array<Filter>>;
  paginate?: InputMaybe<PaginateInput>;
  where?: InputMaybe<FilterExpr>;
};


/** The query root of Ownera's GraphQL interface. */
export type QueryFinancialAssetsArgs = {
  filter?: InputMaybe<Array<Filter>>;
  paginate?: InputMaybe<PaginateInput>;
  where?: InputMaybe<FilterExpr>;
};


/** The query root of Ownera's GraphQL interface. */
export type QueryIssuersArgs = {
  filter?: InputMaybe<Array<Filter>>;
  orderBy?: InputMaybe<IssuerOrder>;
  paginate?: InputMaybe<PaginateInput>;
  where?: InputMaybe<FilterExpr>;
};


/** The query root of Ownera's GraphQL interface. */
export type QueryLedgersArgs = {
  filter?: InputMaybe<Array<Filter>>;
  paginate?: InputMaybe<PaginateInput>;
  where?: InputMaybe<FilterExpr>;
};


/** The query root of Ownera's GraphQL interface. */
export type QueryOperationsArgs = {
  filter?: InputMaybe<Array<Filter>>;
  orderBy?: InputMaybe<OperationOrder>;
  paginate?: InputMaybe<PaginateInput>;
  where?: InputMaybe<FilterExpr>;
};


/** The query root of Ownera's GraphQL interface. */
export type QueryOrganizationsArgs = {
  aggregate?: InputMaybe<Array<Aggregate>>;
  filter?: InputMaybe<Array<Filter>>;
  orderBy?: InputMaybe<OrganizationOrder>;
  paginate?: InputMaybe<PaginateInput>;
  where?: InputMaybe<FilterExpr>;
};


/** The query root of Ownera's GraphQL interface. */
export type QueryPlansArgs = {
  filter?: InputMaybe<Array<Filter>>;
  orderBy?: InputMaybe<ExecutionPlanOrder>;
  paginate?: InputMaybe<PaginateInput>;
  where?: InputMaybe<FilterExpr>;
};


/** The query root of Ownera's GraphQL interface. */
export type QueryReceiptsArgs = {
  filter?: InputMaybe<Array<InputMaybe<Filter>>>;
  orderBy?: InputMaybe<ReceiptOrder>;
  paginate?: InputMaybe<PaginateInput>;
  where?: InputMaybe<FilterExpr>;
};


/** The query root of Ownera's GraphQL interface. */
export type QueryUsersArgs = {
  aggregate?: InputMaybe<Array<Aggregate>>;
  filter?: InputMaybe<Array<Filter>>;
  orderBy?: InputMaybe<UserOrder>;
  paginate?: InputMaybe<PaginateInput>;
  where?: InputMaybe<FilterExpr>;
};


/** The query root of Ownera's GraphQL interface. */
export type QueryWorkflowsArgs = {
  filter?: InputMaybe<Array<Filter>>;
  orderBy?: InputMaybe<WorkflowOrder>;
  paginate?: InputMaybe<PaginateInput>;
  where?: InputMaybe<FilterExpr>;
};

export type Receipt = {
  __typename?: 'Receipt';
  /** Destination owner resource ID */
  destination?: Maybe<Scalars['String']['output']>;
  /** Destination account of transaction */
  destinationAccount?: Maybe<LedgerAccountAsset>;
  id: Scalars['String']['output'];
  /** Ledger name of the receipt leg's asset, as bound on the issuing org */
  ledger: Scalars['String']['output'];
  /** Operation id */
  operationId?: Maybe<Scalars['String']['output']>;
  /** Operation type */
  operationType?: Maybe<OperationType>;
  /** Issuing organization: the org prefix of the receipt leg's asset resource id */
  org: Scalars['String']['output'];
  /** Ledger proof */
  proof?: Maybe<Proof>;
  /** Number of asset units with the transaction */
  quantity: Scalars['String']['output'];
  /** Source owner resource ID */
  source?: Maybe<Scalars['String']['output']>;
  /** Source account of transaction */
  sourceAccount?: Maybe<LedgerAccountAsset>;
  /** Receipt status */
  status: ReceiptStatus;
  /** Receipt timestamp */
  timestamp: Scalars['String']['output'];
  /** Trade details associated with the transaction */
  tradeDetails?: Maybe<TradeDetails>;
  /** Underlying transaction id */
  transactionId?: Maybe<Scalars['String']['output']>;
};

export type ReceiptOrder = {
  direction?: InputMaybe<SortOrder>;
  field?: InputMaybe<ReceiptOrderField>;
};

export enum ReceiptOrderField {
  /** receipt order by determined by Id field */
  Id = 'ID',
}

export type ReceiptState = {
  __typename?: 'ReceiptState';
  receipt: Receipt;
};

export enum ReceiptStatus {
  Invalid = 'Invalid',
  Unknown = 'Unknown',
  Valid = 'Valid',
}

/** Results for receipts query. */
export type Receipts = {
  __typename?: 'Receipts';
  /** Collection of Receipt Objects, conforms to the Filter input if provided. */
  nodes?: Maybe<Array<Receipt>>;
  /** Keeps pagination info in-case limit input wes provided */
  pageInfo?: Maybe<PageInfo>;
};

export type Recipient = Investor;

export type RedeemInstruction = {
  __typename?: 'RedeemInstruction';
  /** asset's redeem amount */
  amount: Scalars['String']['output'];
  /** source account information */
  source: LedgerAccountAsset;
};

export type RedemptionConditions = {
  __typename?: 'RedemptionConditions';
  redemptionDuration: Scalars['String']['output'];
};

export type RedemptionContractDetails = {
  __typename?: 'RedemptionContractDetails';
  asset: AssetOrder;
  settlement?: Maybe<AssetOrder>;
};

export type RedemptionIntent = {
  __typename?: 'RedemptionIntent';
  /** Asset term specifies the asset information and amount of the intent */
  assetTerm: AssetTerm;
  /** Intent conditions */
  conditions: RedemptionConditions;
  /** Destination account - where redeemed asset goes (to issuer) */
  destination?: Maybe<FinP2PAssetAccount>;
  /** Issuer id */
  issuerId: Scalars['String']['output'];
  /** Specify settlement accounts */
  redemptionSettlementInstruction?: Maybe<RedemptionSettlementInstruction>;
  /** Settlement term */
  settlementTerm?: Maybe<SettlementTerm>;
  signaturePolicy: RedemptionSignaturePolicy;
  /** Signature policy type */
  signaturePolicyType: SignaturePolicyType;
};

export type RedemptionSettlementInstruction = {
  __typename?: 'RedemptionSettlementInstruction';
  /** Source accounts where payment comes from */
  accounts?: Maybe<Array<FinP2PAssetAccount>>;
};

export type RedemptionSignaturePolicy = ManualIntentSignaturePolicy | PresignedRedemptionIntentSignaturePolicy;

export type Reference = {
  __typename?: 'Reference';
  referenceId: Scalars['String']['output'];
  referenceType: Scalars['String']['output'];
  workflowId: Scalars['String']['output'];
};

export type ReleaseInstruction = {
  __typename?: 'ReleaseInstruction';
  /** asset's release amount */
  amount: Scalars['String']['output'];
  /** destination account information */
  destination: LedgerAccountAsset;
  /** source account information */
  source: LedgerAccountAsset;
};

export type RepaymentTerm = {
  __typename?: 'RepaymentTerm';
  annualPercentageRate?: Maybe<Scalars['String']['output']>;
  repaymentVolume: Scalars['String']['output'];
};

export type RequestForTransferAssetInstruction = RequestForTransferRequestInstruction | RequestForTransferSendInstruction;

export type RequestForTransferContractDetails = {
  __typename?: 'RequestForTransferContractDetails';
  asset: AssetOrder;
};

export type RequestForTransferIntent = {
  __typename?: 'RequestForTransferIntent';
  asset: RequestForTransferIntentAsset;
  /** resource id of the receiver */
  receiver?: Maybe<Scalars['String']['output']>;
  /** resource id of the sender */
  sender?: Maybe<Scalars['String']['output']>;
  signaturePolicy: RequestForTransferSignaturePolicy;
  signaturePolicyType: SignaturePolicyType;
};

export type RequestForTransferIntentAsset = {
  __typename?: 'RequestForTransferIntentAsset';
  assetInstruction: RequestForTransferAssetInstruction;
  assetTerm: AssetTerm;
};

export type RequestForTransferRequestInstruction = {
  __typename?: 'RequestForTransferRequestInstruction';
  /** Action type - always 'request' */
  action: Scalars['String']['output'];
  receiverAccount?: Maybe<FinP2PAssetAccount>;
};

export type RequestForTransferSendInstruction = {
  __typename?: 'RequestForTransferSendInstruction';
  /** Action type - always 'send' */
  action: Scalars['String']['output'];
  senderAccount?: Maybe<FinP2PAssetAccount>;
};

export type RequestForTransferSignaturePolicy = ManualIntentSignaturePolicy | PresignedRequestForTransferIntentSignaturePolicy;

/** Vote to reset an execution plan, tracked by proposal consensus. */
export type ResetExecutionOperation = Operation & {
  __typename?: 'ResetExecutionOperation';
  cid: Scalars['String']['output'];
  completionTimestamp?: Maybe<Scalars['Int']['output']>;
  creationTimestamp?: Maybe<Scalars['Int']['output']>;
  error?: Maybe<OperationError>;
  /** Same as planId, named to match FinAPI's executionPlanId for client parity. */
  executionPlanId?: Maybe<Scalars['String']['output']>;
  isCompleted: Scalars['Boolean']['output'];
  isFailed: Scalars['Boolean']['output'];
  organizationId?: Maybe<Scalars['String']['output']>;
  planId?: Maybe<Scalars['String']['output']>;
  proposalId?: Maybe<Scalars['String']['output']>;
  status: Scalars['String']['output'];
  type: Scalars['String']['output'];
};

export type RevertHoldInstruction = {
  __typename?: 'RevertHoldInstruction';
  /** destination account information */
  destination: LedgerAccountAsset;
  /** hold instruction sequence number to be reverted */
  holdInstructionSequence: Scalars['Int']['output'];
};

export type SellingContractDetails = {
  __typename?: 'SellingContractDetails';
  asset: AssetOrder;
  /** The settlement group this execution actually used. */
  selectedSettlementGroup?: Maybe<SellingSelectedSettlementGroup>;
  settlement?: Maybe<AssetOrder>;
};

export type SellingIntent = {
  __typename?: 'SellingIntent';
  /** Asset term specifies the asset information and amount of the intent */
  assetTerm: AssetTerm;
  /** resource id of the seller */
  seller?: Maybe<Scalars['String']['output']>;
  sellingSettlementInstruction?: Maybe<SellingSettlementInstruction>;
  /** Settlement term */
  settlementTerm?: Maybe<SettlementTerm>;
  /** The settlement alternatives declared by this intent; exactly one of them is settled. */
  settlements?: Maybe<Array<SellingSettlement>>;
  signaturePolicy: SellingSignaturePolicy;
  /** Signature policy type */
  signaturePolicyType: SignaturePolicyType;
  /** Source account - seller's account from which asset is sold */
  source: FinP2PAssetAccount;
};

/** The settlement group a selling execution actually used, out of the alternatives its intent declared. */
export type SellingSelectedSettlementGroup = {
  __typename?: 'SellingSelectedSettlementGroup';
  /** The legs of the selected group; all of them settle together. */
  legs: Array<AssetOrder>;
};

/** One settlement alternative: all of its legs settle together. */
export type SellingSettlement = {
  __typename?: 'SellingSettlement';
  legs: Array<SellingSettlementLeg>;
};

export type SellingSettlementInstruction = {
  __typename?: 'SellingSettlementInstruction';
  /** Destination accounts where seller receives payment */
  accounts?: Maybe<Array<FinP2PAssetAccount>>;
};

export type SellingSettlementLeg = {
  __typename?: 'SellingSettlementLeg';
  settlementInstruction?: Maybe<SellingSettlementLegInstruction>;
  settlementTerm?: Maybe<SettlementTerm>;
};

/** The account a selling settlement leg pays into. */
export type SellingSettlementLegInstruction = {
  __typename?: 'SellingSettlementLegInstruction';
  destinationAccount?: Maybe<FinP2PAssetAccount>;
};

export type SellingSignaturePolicy = ManualIntentSignaturePolicy | PresignedSellingIntentSignaturePolicy;

export type SequenceTransition = {
  __typename?: 'SequenceTransition';
  sequence: Scalars['Int']['output'];
};

export type SettlementInstruction = {
  __typename?: 'SettlementInstruction';
  details: SettlementInstructionTypeDetails;
};

export type SettlementInstructionTypeDetails = BuyingSettlementInstruction | SellingSettlementInstruction;

export type SettlementTerm = {
  __typename?: 'SettlementTerm';
  details: SettlementTermOptionType;
};

export type SettlementTermOptionType = FullSettlement | NoSettlement | PartialSettlement;

export type Signature = {
  __typename?: 'Signature';
  hashFunction: Scalars['String']['output'];
  signature: Scalars['String']['output'];
  template: Template;
  templateType: TemplateType;
  /** Template shape version. Defaults to 1 when the producer is on a pre-versioning finp2p-core release. */
  templateVersion: Scalars['Int']['output'];
};

export enum SignaturePolicyType {
  ManualPolicy = 'ManualPolicy',
  PresignedPolicy = 'PresignedPolicy',
}

export type SignatureProof = {
  __typename?: 'SignatureProof';
  signature: Signature;
};

export type SignatureProofPolicy = {
  __typename?: 'SignatureProofPolicy';
  signatureTemplate: SignatureTemplate;
  templateVersion: Scalars['Int']['output'];
  verifyingKey: Scalars['String']['output'];
};

export enum SignatureTemplate {
  Eip712 = 'EIP712',
  HashList = 'HashList',
  Unknown = 'Unknown',
}

export enum SortOrder {
  Asc = 'ASC',
  Desc = 'DESC',
}

export type StatusTransition = {
  __typename?: 'StatusTransition';
  status: ExecutionPlanStatus;
};

export type Subscription = {
  __typename?: 'Subscription';
  /** Fires when a new agreement is committed to the read model. orgIds matches the agreement's owner org or any participant org; omitted matches everything. */
  agreementAdded: Agreement;
  /** Fires when any field of an existing agreement changes (status, version, appended events, accounts registry). Filters AND together; omitted matches everything. */
  agreementChanged: Agreement;
  assetDataChanged: AssetDataItem;
  /** Fires when a new intent is committed. Filters AND together; if a filter is omitted it matches everything. ownerOrgIds matches the org ids OSS derives for the intent. For Move this is the source asset's org; for two-sided intents like RequestForTransfer and Loan it may include both sides. */
  intentAdded: Intent;
  /** Fires when an intent field listed in fieldNames changes. Same filter semantics as intentAdded. */
  intentChanged: Intent;
  /** Fires when an operation is first projected. Filters AND together; an omitted filter matches everything. */
  operationAdded: Operation;
  /** Fires when an operation field listed in fieldNames changes — use IsCompleted for completion and IsFailed for failure. Same filter semantics as operationAdded. */
  operationChanged: Operation;
  planAdded: ExecutionPlan;
  plansChangedBy: ExecutionPlan;
  receiptAdded: Receipt;
  userHoldingAdded: User;
  userHoldingChanged: User;
};


export type SubscriptionAgreementAddedArgs = {
  orgIds?: InputMaybe<Array<Scalars['String']['input']>>;
};


export type SubscriptionAgreementChangedArgs = {
  agreementIds?: InputMaybe<Array<Scalars['String']['input']>>;
  orgIds?: InputMaybe<Array<Scalars['String']['input']>>;
};


export type SubscriptionAssetDataChangedArgs = {
  dataTypes?: InputMaybe<Array<DataType>>;
  identifierType?: InputMaybe<AssetDataIdentifierType>;
  identifierValue?: InputMaybe<Scalars['String']['input']>;
};


export type SubscriptionIntentAddedArgs = {
  assetIds?: InputMaybe<Array<Scalars['String']['input']>>;
  intentTypes?: InputMaybe<Array<IntentTypes>>;
  ownerOrgIds?: InputMaybe<Array<Scalars['String']['input']>>;
};


export type SubscriptionIntentChangedArgs = {
  assetIds?: InputMaybe<Array<Scalars['String']['input']>>;
  fieldNames: Array<IntentField>;
  intentTypes?: InputMaybe<Array<IntentTypes>>;
  ownerOrgIds?: InputMaybe<Array<Scalars['String']['input']>>;
};


export type SubscriptionOperationAddedArgs = {
  cids?: InputMaybe<Array<Scalars['String']['input']>>;
  orgIds?: InputMaybe<Array<Scalars['String']['input']>>;
  types?: InputMaybe<Array<Scalars['String']['input']>>;
};


export type SubscriptionOperationChangedArgs = {
  cids?: InputMaybe<Array<Scalars['String']['input']>>;
  fieldNames: Array<OperationField>;
  orgIds?: InputMaybe<Array<Scalars['String']['input']>>;
  types?: InputMaybe<Array<Scalars['String']['input']>>;
};


export type SubscriptionPlansChangedByArgs = {
  fieldNames: Array<PlanField>;
};


export type SubscriptionUserHoldingChangedArgs = {
  fieldNames: Array<HoldingFields>;
};

export type SuccessState = {
  __typename?: 'SuccessState';
  output?: Maybe<SuccessStateOutput>;
};

export type SuccessStateOutput = InstructionReceipts | Receipt;

/**
 * An atomic two-legged exchange settled in a single ledger transaction. `asset` and `settlement` are
 * trade roles fixed by position, not per-organization perspectives.
 */
export type SwapInstruction = {
  __typename?: 'SwapInstruction';
  /** the leg giving up the traded asset */
  asset: SwapLeg;
  /** absolute epoch-second cutoff after which the exchange may no longer settle */
  deadline: Scalars['Int']['output'];
  /** the leg giving up what pays for it */
  settlement: SwapLeg;
};

/** One side of an atomic exchange: who gives up what, and to whom. */
export type SwapLeg = {
  __typename?: 'SwapLeg';
  /** this leg's amount */
  amount: Scalars['String']['output'];
  /** destination account information */
  destination: LedgerAccountAsset;
  /** resource id of the owner receiving this leg's asset */
  destinationOwner: Scalars['String']['output'];
  /** source account information */
  source: LedgerAccountAsset;
  /** resource id of the owner giving up this leg's asset */
  sourceOwner: Scalars['String']['output'];
};

export type Template = Eip712Template | HashlistTemplate;

/** Represents an Asset token balance information. */
export type TokenBalance = {
  __typename?: 'TokenBalance';
  assetId: Scalars['String']['output'];
  availableQuantity: Scalars['String']['output'];
  heldQuantity: Scalars['String']['output'];
  quantity: Scalars['String']['output'];
  syncedAvailableQuantity: Scalars['String']['output'];
  syncedHeldQuantity: Scalars['String']['output'];
  syncedQuantity: Scalars['String']['output'];
  syncedQuantityTimestamp: Scalars['Int']['output'];
  transactionsDetails?: Maybe<Array<TransactionDetails>>;
  userId: Scalars['String']['output'];
  /** Owner's display name; empty when the owner profile carries no name claim. */
  userName: Scalars['String']['output'];
};

/** Plain token transfer, tracked by its execution plan. */
export type TokenOperation = Operation & {
  __typename?: 'TokenOperation';
  cid: Scalars['String']['output'];
  completionTimestamp?: Maybe<Scalars['Int']['output']>;
  creationTimestamp?: Maybe<Scalars['Int']['output']>;
  error?: Maybe<OperationError>;
  /** Same as planId, named to match FinAPI's executionOperationResult for client parity. */
  executionPlanId?: Maybe<Scalars['String']['output']>;
  isCompleted: Scalars['Boolean']['output'];
  isFailed: Scalars['Boolean']['output'];
  organizationId?: Maybe<Scalars['String']['output']>;
  planId?: Maybe<Scalars['String']['output']>;
  receiptIds?: Maybe<Array<Scalars['String']['output']>>;
  status: Scalars['String']['output'];
  type: Scalars['String']['output'];
};

/** Results for tokens query. */
export type TokensBalances = {
  __typename?: 'TokensBalances';
  /** Collection of Aggregate Results, if an Aggregate input was provided. */
  aggregate?: Maybe<Array<AggregateResult>>;
  /** Collection of Token Objects, conforms to the Filter input if provided. */
  nodes?: Maybe<Array<TokenBalance>>;
  /** Keeps pagination info when a paginate input was provided. */
  pageInfo?: Maybe<PageInfo>;
};

export type TradeDetails = {
  __typename?: 'TradeDetails';
  /** Details of ExecutionPlan associated with the transaction */
  executionContext?: Maybe<ExecutionContext>;
  /** Intent  associated with the transaction */
  intent?: Maybe<Intent>;
};

export type TransactionDetails = {
  __typename?: 'TransactionDetails';
  index: Scalars['Int']['output'];
  quantity: Scalars['String']['output'];
  transactionId: Scalars['String']['output'];
};

export type TransferContractDetails = {
  __typename?: 'TransferContractDetails';
  asset: AssetOrder;
};

export type TransferInstruction = {
  __typename?: 'TransferInstruction';
  /** asset's transfer amount */
  amount: Scalars['String']['output'];
  /** destination account information */
  destination: LedgerAccountAsset;
  /** source account information */
  source: LedgerAccountAsset;
};

export type Transition = SequenceTransition | StatusTransition;

export type UnknownState = {
  __typename?: 'UnknownState';
  _ignore?: Maybe<Scalars['Boolean']['output']>;
};

/** Represents an User in the network. */
export type User = Profile & {
  __typename?: 'User';
  accounts?: Maybe<Array<FinP2PAccount>>;
  /** Collection of certificates associated with the Profile. */
  certificates: Certificates;
  /** Data access permissions this resource has received from other organizations */
  dataAccessReceived?: Maybe<Array<Maybe<Scalars['String']['output']>>>;
  /** finIds keys associated with this investor */
  finIds?: Maybe<Array<Scalars['String']['output']>>;
  holdings: Holdings;
  id: Scalars['String']['output'];
  /** User's associated messages */
  inbox: Messages;
  /** Org-local labels computed by the router; filter via key `labels.<key>`. */
  labels?: Maybe<Array<KeyValuePair>>;
  /** Profile metadata, contains ACL information of the profile. */
  metadata: ProfileMetadata;
  name: Scalars['String']['output'];
  /** Investor network accounts (LA-managed wallets) bound to a specific organization and asset. */
  networkAccounts?: Maybe<Array<InvestorNetworkAccount>>;
  /** Organization id to whom this profile is associated with. */
  organizationId: Scalars['String']['output'];
  /** user resource version */
  version: Scalars['String']['output'];
};


/** Represents an User in the network. */
export type UserAccountsArgs = {
  filter?: InputMaybe<Array<Filter>>;
  where?: InputMaybe<FilterExpr>;
};


/** Represents an User in the network. */
export type UserCertificatesArgs = {
  aggregates?: InputMaybe<Array<Aggregate>>;
  filter?: InputMaybe<Array<Filter>>;
  where?: InputMaybe<FilterExpr>;
};


/** Represents an User in the network. */
export type UserHoldingsArgs = {
  aggregates?: InputMaybe<Array<Aggregate>>;
  filter?: InputMaybe<Array<Filter>>;
  where?: InputMaybe<FilterExpr>;
};


/** Represents an User in the network. */
export type UserInboxArgs = {
  filter?: InputMaybe<Array<Filter>>;
  where?: InputMaybe<FilterExpr>;
};


/** Represents an User in the network. */
export type UserNetworkAccountsArgs = {
  filter?: InputMaybe<Array<Filter>>;
  where?: InputMaybe<FilterExpr>;
};

export type UserOrder = {
  direction?: InputMaybe<SortOrder>;
  field?: InputMaybe<UserOrderField>;
};

export enum UserOrderField {
  /** users order by determined by Id field */
  Id = 'ID',
  /** users order by determined by Name field */
  Name = 'NAME',
}

/** Results for asset query. */
export type Users = {
  __typename?: 'Users';
  aggregate?: Maybe<Array<AggregateResult>>;
  /** Collection of User Objects, conforms to the Filter input if provided. */
  nodes?: Maybe<Array<User>>;
  /** Keeps pagination info in-case limit input wes provided */
  pageInfo?: Maybe<PageInfo>;
};

/** Regulation Verifier */
export type Verifier = {
  __typename?: 'Verifier';
  /** Verifier ID */
  id?: Maybe<Scalars['String']['output']>;
  /** Verifier Name */
  name?: Maybe<Scalars['String']['output']>;
  /** Provider type: REG_APP_STORE, OTHER */
  provider?: Maybe<Scalars['String']['output']>;
};

/** Wallet account for blockchain wallets */
export type WalletAccount = {
  __typename?: 'WalletAccount';
  /** Wallet address */
  address: Scalars['String']['output'];
  /** Type of wallet (e.g., ethereum) */
  type: Scalars['String']['output'];
};

/** Withdraw request, completed once its receipt is stored. */
export type WithdrawOperation = Operation & {
  __typename?: 'WithdrawOperation';
  cid: Scalars['String']['output'];
  completionTimestamp?: Maybe<Scalars['Int']['output']>;
  creationTimestamp?: Maybe<Scalars['Int']['output']>;
  error?: Maybe<OperationError>;
  isCompleted: Scalars['Boolean']['output'];
  isFailed: Scalars['Boolean']['output'];
  organizationId?: Maybe<Scalars['String']['output']>;
  receiptIds?: Maybe<Array<Scalars['String']['output']>>;
  status: Scalars['String']['output'];
  type: Scalars['String']['output'];
  workflowIds?: Maybe<Array<Scalars['String']['output']>>;
};

export type Workflow = {
  __typename?: 'Workflow';
  /** Admin operations history and metadata */
  adminMetadata?: Maybe<WorkflowAdminMetadata>;
  /** Available admin actions for this workflow */
  availableActions: Array<WorkflowAdminAction>;
  /** Workflow creation timestamp */
  creationTimestamp: Scalars['Int']['output'];
  /** the time workflow expires */
  expires: Scalars['Int']['output'];
  /** Health status and admin information for the workflow */
  health?: Maybe<WorkflowHealth>;
  /** Id of the workflow */
  id: Scalars['String']['output'];
  /** Workflow last-modified timestamp (epoch millis) */
  lastModified: Scalars['Int']['output'];
  /** metadata of the workflow */
  metadata: WorkflowMetadata;
  /** Name of the workflow */
  name: Scalars['String']['output'];
  /** list of reference information of the workflow */
  references: Array<Reference>;
  /** Current state of the workflow (always populated; the state machine's current node, e.g. the initial state before any transition is applied) */
  state: Scalars['String']['output'];
  /** Current status of the workflow */
  status: Scalars['String']['output'];
  /** Id of the last applied transition (empty until the first transition; use `state` for the workflow's current position) */
  transitionId: Scalars['String']['output'];
  /** version of the workflow */
  version: Scalars['Int']['output'];
};

/** Available admin actions for workflows */
export enum WorkflowAdminAction {
  Cancel = 'CANCEL',
  Reset = 'RESET',
  Resume = 'RESUME',
  Retry = 'RETRY',
}

/** Admin operations metadata and history */
export type WorkflowAdminMetadata = {
  __typename?: 'WorkflowAdminMetadata';
  /** Last admin action performed */
  lastAction?: Maybe<WorkflowAdminAction>;
  /** User who performed last action */
  lastActionBy?: Maybe<Scalars['String']['output']>;
  /** Timestamp of last admin action */
  lastActionTimestamp?: Maybe<Scalars['Int']['output']>;
  /** Total number of admin actions performed */
  totalActions: Scalars['Int']['output'];
};

/** Health status of a workflow */
export type WorkflowHealth = {
  __typename?: 'WorkflowHealth';
  /** List of health issues detected */
  issues: Array<Scalars['String']['output']>;
  /** Timestamp when health was last assessed */
  lastAssessed: Scalars['Int']['output'];
  /** Additional health metadata */
  metadata?: Maybe<WorkflowHealthMetadata>;
  /** Current health status */
  status: WorkflowHealthStatus;
  /** health stuck since timestamp */
  stuckSince: Scalars['Int']['output'];
};

/** Additional health assessment metadata */
export type WorkflowHealthMetadata = {
  __typename?: 'WorkflowHealthMetadata';
  /** Workflow age in seconds */
  age?: Maybe<Scalars['Int']['output']>;
  /** Number of retry attempts */
  retryCount?: Maybe<Scalars['Int']['output']>;
  /** Time since last state transition */
  timeSinceLastTransition?: Maybe<Scalars['Int']['output']>;
};

/** Health status enumeration */
export enum WorkflowHealthStatus {
  Healthy = 'HEALTHY',
  /** Actively retrying but still working (durable signal, core #1251) — not an error state */
  Retrying = 'RETRYING',
  Stale = 'STALE',
  Stuck = 'STUCK',
  Unhealthy = 'UNHEALTHY',
}

export type WorkflowMetadata = {
  __typename?: 'WorkflowMetadata';
  correlationIds?: Maybe<Array<Scalars['String']['output']>>;
  /** Non-resetting retry aggregate across all states (never-give-up visibility, core #1251) */
  cumulativeRetries: Scalars['Int']['output'];
  currentStateRetry: Scalars['Int']['output'];
  retry: Scalars['Int']['output'];
  traceId: Scalars['String']['output'];
  /** TTL of the workflow */
  ttl: Scalars['Int']['output'];
};

/** An admin command laid onto an arbitrary target workflow, or an investor network-account bind. */
export type WorkflowOperation = Operation & {
  __typename?: 'WorkflowOperation';
  cid: Scalars['String']['output'];
  completionTimestamp?: Maybe<Scalars['Int']['output']>;
  creationTimestamp?: Maybe<Scalars['Int']['output']>;
  error?: Maybe<OperationError>;
  isCompleted: Scalars['Boolean']['output'];
  isFailed: Scalars['Boolean']['output'];
  organizationId?: Maybe<Scalars['String']['output']>;
  status: Scalars['String']['output'];
  type: Scalars['String']['output'];
  workflowIds?: Maybe<Array<Scalars['String']['output']>>;
};

export type WorkflowOrder = {
  direction?: InputMaybe<SortOrder>;
  field?: InputMaybe<WorkflowOrderField>;
};

export enum WorkflowOrderField {
  CorrelationId = 'CORRELATION_ID',
  CreationTimestamp = 'CREATION_TIMESTAMP',
  HealthStatus = 'HEALTH_STATUS',
  LastModified = 'LAST_MODIFIED',
  /** workflow order */
  Name = 'NAME',
  ReferenceId = 'REFERENCE_ID',
  Status = 'STATUS',
}

export type Workflows = {
  __typename?: 'Workflows';
  nodes?: Maybe<Array<Workflow>>;
  /** Keeps pagination info in-case limit input wes provided */
  pageInfo?: Maybe<PageInfo>;
};

export enum TemplateType {
  Eip712Template = 'EIP712Template',
  HashListTemplate = 'HashListTemplate',
}

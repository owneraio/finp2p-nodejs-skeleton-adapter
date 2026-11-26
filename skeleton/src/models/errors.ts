

export class ValidationError extends Error {

  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class BusinessError extends Error {

  code: number;

  constructor(code: number, message: string) {
    super(message);
    this.name = 'BusinessError';
    this.code = code;
  }

}

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

/** Requested capability is not supported by this adapter. Mapped to HTTP 501. */
export class NotSupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotSupportedError';
  }
}

/**
 * The (organization, asset, account) key is already bound. Mapped to HTTP 409.
 *
 * Not thrown by `NetworkAccountServiceImpl` and cannot be: a repeat create for
 * the same finId replays the recorded binding instead of conflicting. Part of
 * the error vocabulary for adapter implementations that want strict
 * already-bound semantics instead.
 */
export class AccountAlreadyBoundError extends Error {

  code: number;

  constructor(message: string, code: number = 0) {
    super(message);
    this.name = 'AccountAlreadyBoundError';
    this.code = code;
  }
}

/** The supplied network account does not match the ledger's address shape. Mapped to HTTP 400. */
export class AccountInvalidShapeError extends Error {

  code: number;

  constructor(message: string, code: number = 0) {
    super(message);
    this.name = 'AccountInvalidShapeError';
    this.code = code;
  }
}

/**
 * No account operation / record for the given identifier. Mapped to HTTP 404.
 *
 * Not thrown by `NetworkAccountServiceImpl`, which treats removing an absent
 * account as success so router retries don't fail. Part of the error vocabulary
 * for adapter implementations that want strict remove semantics instead.
 */
export class AccountNotFoundError extends Error {

  code: number;

  constructor(message: string, code: number = 0) {
    super(message);
    this.name = 'AccountNotFoundError';
    this.code = code;
  }
}

/**
 * Router error codes (owneraio/pkg errorcodes) for account onboarding. A 4xx answer whose
 * `errors` body carries one reaches the client as that error.
 */
export const AccountErrorCodes = {
  alreadyBound: 7344,
  badSignature: 7345,
  challengeTimeout: 7346,
  notFound: 7348,
  invalidState: 7349,
} as const;

/**
 * The proof does not fulfill the challenge, e.g. a signature that does not verify. Throw
 * it from completeAccountChallenge: the challenge stays open for another proof. Mapped to
 * HTTP 401, which the router reads as a business refusal because the body carries a code.
 */
export class AccountProofRefusedError extends Error {

  code: number;

  constructor(message: string, code: number = AccountErrorCodes.badSignature) {
    super(message);
    this.name = 'AccountProofRefusedError';
    this.code = code;
  }
}

/**
 * The account operation cannot take this request in its current state, e.g. a proof for a
 * create that has issued no challenge or has failed. Mapped to HTTP 409.
 */
export class AccountInvalidStateError extends Error {

  code: number;

  constructor(message: string, code: number = AccountErrorCodes.invalidState) {
    super(message);
    this.name = 'AccountInvalidStateError';
    this.code = code;
  }
}

/**
 * A proof for a create that has failed because its challenge expired: completeAccountChallenge
 * settled it with AccountErrorCodes.challengeTimeout. Mapped to HTTP 410.
 */
export class AccountChallengeExpiredError extends Error {

  code: number;

  constructor(message: string, code: number = AccountErrorCodes.challengeTimeout) {
    super(message);
    this.name = 'AccountChallengeExpiredError';
    this.code = code;
  }
}

/** A policy refusal, not a fault: the party stays blocked by mechanisms this
 *  deployment does not operate. Mapped to 409, so it is distinguishable from an
 *  outage. Mapped to HTTP 409. */
export class WhitelistRefusedError extends Error {

  mechanisms: string[];

  constructor(message: string, mechanisms: string[] = []) {
    super(message);
    this.name = 'WhitelistRefusedError';
    this.mechanisms = mechanisms;
  }
}

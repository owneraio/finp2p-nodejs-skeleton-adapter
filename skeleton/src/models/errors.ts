

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

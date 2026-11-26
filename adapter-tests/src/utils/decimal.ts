const DECIMAL = /^[0-9]+(\.[0-9]+)?$/;

const parts = (value: string): [string, string] => {
  if (!DECIMAL.test(value)) {
    throw new Error(`not a non-negative decimal: ${JSON.stringify(value)}`);
  }
  const [whole, fraction = ''] = value.split('.');
  return [whole.replace(/^0+(?=\d)/, ''), fraction.replace(/0+$/, '')];
};

/** Compares two non-negative decimal strings digit by digit, so no precision is lost: -1, 0 or 1. */
export const compareDecimals = (a: string, b: string): number => {
  const [wholeA, fractionA] = parts(a);
  const [wholeB, fractionB] = parts(b);
  if (wholeA.length !== wholeB.length) {
    return wholeA.length < wholeB.length ? -1 : 1;
  }
  const width = Math.max(fractionA.length, fractionB.length);
  const left = wholeA + fractionA.padEnd(width, '0');
  const right = wholeB + fractionB.padEnd(width, '0');
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
};

/** True when the amount lies within the limits; an absent limit does not bound that side. */
export const amountWithinLimits = (amount: string, limits?: { minAmount?: string; maxAmount?: string }): boolean =>
  (limits?.minAmount === undefined || compareDecimals(amount, limits.minAmount) >= 0)
  && (limits?.maxAmount === undefined || compareDecimals(amount, limits.maxAmount) <= 0);

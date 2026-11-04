import { FeeData } from 'ethers';
import { bump, bumpFees, attemptFees } from '../src/fees';
import { serializeTxRequest, deserializeTxRequest } from '../src/types';

describe('bump', () => {
  test('adds pct rounded up', () => {
    expect(bump(100n, 13)).toBe(113n);
    expect(bump(1000n, 13)).toBe(1130n);
    // 7 * 13 / 100 = 0.91 → rounds up to 1
    expect(bump(7n, 13)).toBe(8n);
    expect(bump(0n, 13)).toBe(0n);
  });
});

describe('bumpFees', () => {
  const feeData = (maxFee: bigint | null, priority: bigint | null, gasPrice: bigint | null) => new FeeData(gasPrice, maxFee, priority);

  test('eip1559: bumps both fields at least pct above previous', () => {
    const prev = { maxFeePerGas: 1_000_000n, maxPriorityFeePerGas: 100_000n };
    const fees = bumpFees(prev, feeData(500_000n, 50_000n, null), 13);
    expect(fees.maxFeePerGas).toBe(1_130_000n);
    expect(fees.maxPriorityFeePerGas).toBe(113_000n);
    expect(fees.gasPrice).toBeUndefined();
  });

  test('eip1559: never below current network estimate', () => {
    const prev = { maxFeePerGas: 100n, maxPriorityFeePerGas: 10n };
    const fees = bumpFees(prev, feeData(1_000_000n, 100_000n, null), 13);
    expect(fees.maxFeePerGas).toBe(1_000_000n);
    expect(fees.maxPriorityFeePerGas).toBe(100_000n);
  });

  test('eip1559: maxFeePerGas never below maxPriorityFeePerGas', () => {
    const prev = { maxFeePerGas: 100n, maxPriorityFeePerGas: 100n };
    const fees = bumpFees(prev, feeData(null, 500n, null), 13);
    expect(fees.maxFeePerGas!).toBeGreaterThanOrEqual(fees.maxPriorityFeePerGas!);
  });

  test('legacy: bumps gasPrice', () => {
    const fees = bumpFees({ gasPrice: 1_000n }, feeData(null, null, 900n), 13);
    expect(fees.gasPrice).toBe(1_130n);
    expect(fees.maxFeePerGas).toBeUndefined();
  });

  test('no previous fees: bumps network estimate', () => {
    const fees = bumpFees(null, feeData(1_000n, 100n, null), 13);
    expect(fees.maxFeePerGas).toBe(1_130n);
    expect(fees.maxPriorityFeePerGas).toBe(113n);
  });
});

describe('attemptFees', () => {
  test('parses recorded fee strings', () => {
    expect(attemptFees({ hash: '0x1', maxFeePerGas: '1000', maxPriorityFeePerGas: '100', submittedAt: 't' }))
      .toEqual({ maxFeePerGas: 1000n, maxPriorityFeePerGas: 100n });
    expect(attemptFees({ hash: '0x1', gasPrice: '500', submittedAt: 't' })).toEqual({ gasPrice: 500n });
    expect(attemptFees({ hash: '0x1', submittedAt: 't' })).toBeNull();
    expect(attemptFees(undefined)).toBeNull();
  });
});

describe('serializeTxRequest', () => {
  test('round-trips bigints through strings', () => {
    const tx = {
      to: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
      data: '0xabcdef',
      value: 12345678901234567890n,
      gasLimit: 21000n,
      maxFeePerGas: 2_000_000_000n,
      maxPriorityFeePerGas: 1_000_000_000n,
      chainId: 31337n,
      type: 2,
    };
    const s = serializeTxRequest(tx);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
    expect(deserializeTxRequest(s)).toEqual(tx);
  });

  test('rejects unresolved address objects', () => {
    expect(() => serializeTxRequest({ to: { getAddress: async () => '0x0' } as any })).toThrow(/not a resolved string/);
  });
});

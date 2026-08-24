import { assertValidPostgresIdentifier, toPostgresIdentifier, MAX_POSTGRES_IDENTIFIER_LENGTH } from '../../src/storage/config'

describe('assertValidPostgresIdentifier', () => {
  test('accepts valid identifiers', () => {
    expect(() => assertValidPostgresIdentifier('ledger_adapter')).not.toThrow();
    expect(() => assertValidPostgresIdentifier('_underscore')).not.toThrow();
    expect(() => assertValidPostgresIdentifier('a1_b2')).not.toThrow();
  });

  test('rejects invalid shapes', () => {
    expect(() => assertValidPostgresIdentifier('')).toThrow();
    expect(() => assertValidPostgresIdentifier('1adapter')).toThrow();
    expect(() => assertValidPostgresIdentifier('sepolia-mainnet')).toThrow();
    expect(() => assertValidPostgresIdentifier('drop table; --')).toThrow();
    expect(() => assertValidPostgresIdentifier('héllo')).toThrow();
  });

  test('rejects identifiers over the byte cap', () => {
    expect(() => assertValidPostgresIdentifier('a'.repeat(MAX_POSTGRES_IDENTIFIER_LENGTH))).not.toThrow();
    expect(() => assertValidPostgresIdentifier('a'.repeat(MAX_POSTGRES_IDENTIFIER_LENGTH + 1))).toThrow();
  });
});

describe('toPostgresIdentifier', () => {
  test('passes through already-valid identifiers', () => {
    expect(toPostgresIdentifier('ledger_adapter')).toBe('ledger_adapter');
    expect(toPostgresIdentifier('_underscore')).toBe('_underscore');
  });

  test('replaces disallowed characters with underscores', () => {
    expect(toPostgresIdentifier('sepolia-mainnet')).toBe('sepolia_mainnet');
    expect(toPostgresIdentifier('ada.pter id')).toBe('ada_pter_id');
    expect(toPostgresIdentifier('héllo')).toBe('h_llo');
  });

  test('prefixes underscore when result would start with a digit', () => {
    expect(toPostgresIdentifier('1adapter')).toBe('_1adapter');
    expect(toPostgresIdentifier('0')).toBe('_0');
  });

  test('truncates with a stable hash suffix and avoids prefix collisions', () => {
    const a = 'Lorem ipsum dolor sit amet consectetur adipiscing elit sed do alpha';
    const b = 'Lorem ipsum dolor sit amet consectetur adipiscing elit sed do bravo';
    const outA = toPostgresIdentifier(a);
    const outB = toPostgresIdentifier(b);

    expect(outA).toHaveLength(50);
    expect(outB).toHaveLength(50);
    expect(outA).toMatch(/^Lorem_ipsum_dolor_sit_amet_consectetur_ad_[0-9a-f]{8}$/);
    expect(outB).toMatch(/^Lorem_ipsum_dolor_sit_amet_consectetur_ad_[0-9a-f]{8}$/);
    expect(outA).not.toBe(outB);
    expect(toPostgresIdentifier(a)).toBe(outA);
  });

  test('throws on empty input', () => {
    expect(() => toPostgresIdentifier('')).toThrow();
  });
});

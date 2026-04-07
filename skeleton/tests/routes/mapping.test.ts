import { assetIdentifierFromAPI, assetIdentifierOptFromAPI } from '../../src/routes/mapping';

describe('assetIdentifierFromAPI', () => {
  test('extracts networkId from networkInfo', () => {
    const result = assetIdentifierFromAPI({
      assetIdentifierType: 'CUSTOM',
      assetIdentifierValue: 'MY_ASSET_123',
      networkInfo: { networkId: 'eip155:11155111' },
    });

    expect(result.type).toBe('CUSTOM');
    expect(result.value).toBe('MY_ASSET_123');
    expect(result.networkId).toBe('eip155:11155111');
  });

  test('networkId is undefined when networkInfo is absent', () => {
    const result = assetIdentifierFromAPI({
      assetIdentifierType: 'ISIN',
      assetIdentifierValue: 'US0378331005',
    });

    expect(result.type).toBe('ISIN');
    expect(result.value).toBe('US0378331005');
    expect(result.networkId).toBeUndefined();
  });

  test('networkId is undefined when networkInfo has no networkId', () => {
    const result = assetIdentifierFromAPI({
      assetIdentifierType: 'CUSTOM',
      assetIdentifierValue: 'ASSET',
      networkInfo: {},
    });

    expect(result.networkId).toBeUndefined();
  });

  test('assetIdentifierOptFromAPI returns undefined for undefined input', () => {
    expect(assetIdentifierOptFromAPI(undefined)).toBeUndefined();
  });
});

import { eip712TemplateFromAPI, eip712TypesToAPI, swapLegFromAPI } from '../../src/routes/mapping';
import { components } from '../../src/routes/model-gen';

const finId = (n: string) => n.padEnd(66, '0');
const ledgerIdentifier = {
  assetIdentifierType: 'CAIP-19', network: 'eip155:1', standard: 'ERC20', tokenId: '0x01',
} as const;

// Shaped like what the router sends: a definitions list, EIP712Domain included.
const apiTypes = {
  definitions: [
    { name: 'EIP712Domain', fields: [{ name: 'name', type: 'string' }, { name: 'chainId', type: 'uint256' }] },
    { name: 'FinId', fields: [{ name: 'idkey', type: 'string' }] },
    { name: 'Term', fields: [{ name: 'assetId', type: 'string' }, { name: 'amount', type: 'string' }] },
    { name: 'Selling', fields: [{ name: 'buyer', type: 'FinId' }, { name: 'asset', type: 'Term' }] },
  ],
};

const apiTemplate = {
  type: 'EIP712' as const,
  primaryType: 'Selling',
  domain: { name: 'FinP2P', version: '1', chainId: 1, verifyingContract: '0x0' },
  message: {},
  types: apiTypes,
  hash: '',
};

describe('EIP712 types mapping', () => {

  // Regression: adapters read template.types.definitions; the mapper used to
  // drop it, so a primary type looked undefined to them.
  test('the router declaration survives on definitions, EIP712Domain included', () => {
    const { types } = eip712TemplateFromAPI(apiTemplate as any);

    expect(types.definitions).toBeDefined();
    expect(types.definitions!.map(d => d.name))
      .toEqual(['EIP712Domain', 'FinId', 'Term', 'Selling']);
    expect(types.definitions!.find(d => d.name === 'Selling')!.fields)
      .toEqual([{ name: 'buyer', type: 'FinId' }, { name: 'asset', type: 'Term' }]);
  });

  // It must stay invisible to anything that walks the map — ethers rejects an
  // EIP712Domain entry in `types`, and a stray key would be read as a type.
  test('definitions is non-enumerable', () => {
    const { types } = eip712TemplateFromAPI(apiTemplate as any);

    expect(Object.keys(types).sort()).toEqual(['FinId', 'Selling', 'Term']);
    expect(JSON.parse(JSON.stringify(types))).not.toHaveProperty('definitions');
  });

  test('a received template round-trips back to the API verbatim', () => {
    const { types } = eip712TemplateFromAPI(apiTemplate as any);

    expect(eip712TypesToAPI(types)).toEqual(apiTypes);
  });

  test('the swap leg carries the definitions through to the adapter', () => {
    const leg: components['schemas']['swapAssetLeg'] = {
      source: { finId: finId('01'), asset: { resourceId: 'org1:102:a', ledgerIdentifier } },
      destination: { finId: finId('02'), asset: { resourceId: 'org2:102:a', ledgerIdentifier } },
      quantity: '10',
      signature: { template: apiTemplate, signature: 'ab', hashFunc: 'keccak-256' },
    } as any;

    const mapped = swapLegFromAPI(leg, 'source');
    const types = (mapped.signature!.template as any).types;

    expect(types.definitions.map((d: any) => d.name)).toContain('Selling');
    expect(Object.keys(types)).not.toContain('definitions');
  });
});

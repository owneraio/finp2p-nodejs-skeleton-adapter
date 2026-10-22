import { TypedDataEncoder } from 'ethers';
import {
  attachEip712Definitions, eip712Definitions, rehydrateEip712Definitions, EIP712Types,
} from '../../src/models';
import { eip712TypesToAPI } from '../../src/routes/mapping';

const domainFields = [
  { name: 'name', type: 'string' }, { name: 'version', type: 'string' },
  { name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' },
];
const finIdFields = [{ name: 'idkey', type: 'string' }];
const sellingFields = [{ name: 'assetId', type: 'string' }];

const declaration = [
  { name: 'EIP712Domain', fields: domainFields },
  { name: 'FinId', fields: finIdFields },
  { name: 'Selling', fields: sellingFields },
];
const bareMap = () => ({ FinId: finIdFields, Selling: sellingFields } as unknown as EIP712Types);

describe('EIP-712 declaration: workflow replay', () => {
  // #260 was closed because making the declaration enumerable changed the
  // serialized inputs, and the workflow dedupe key is (method, inputs) — an
  // operation stored before the upgrade could then execute a swap twice.
  test('attaching the declaration does not change the serialized form', () => {
    const attached = attachEip712Definitions(bareMap(), declaration);

    expect(JSON.stringify(attached)).toBe(JSON.stringify(bareMap()));
    expect(Object.keys(attached)).toEqual(['FinId', 'Selling']);
  });

  test('the declaration is lost to a JSON round trip and rebuilt on replay', () => {
    const attached = attachEip712Definitions(bareMap(), declaration);
    expect(eip712Definitions(attached)).toBeDefined();

    const replayed = JSON.parse(JSON.stringify(attached)) as EIP712Types;
    expect(eip712Definitions(replayed)).toBeUndefined();

    const names = (eip712Definitions(rehydrateEip712Definitions(replayed)) ?? []).map(d => d.name);
    expect(names).toEqual(['EIP712Domain', 'FinId', 'Selling']);
  });

  test('rehydration leaves an already-attached declaration alone', () => {
    const attached = attachEip712Definitions(bareMap(), declaration);

    expect(eip712Definitions(rehydrateEip712Definitions(attached))).toHaveLength(3);
  });
});

describe('EIP-712 declaration: a struct named `definitions`', () => {
  const collidingMap = () => ({
    Selling: [{ name: 'data', type: 'definitions' }],
    definitions: [{ name: 'x', type: 'string' }],
  } as unknown as EIP712Types);
  const collidingDeclaration = [
    { name: 'EIP712Domain', fields: domainFields },
    { name: 'Selling', fields: [{ name: 'data', type: 'definitions' }] },
    { name: 'definitions', fields: [{ name: 'x', type: 'string' }] },
  ];

  test('the struct survives and ethers can still hash the message', () => {
    const attached = attachEip712Definitions(collidingMap(), collidingDeclaration);

    expect(Object.keys(attached)).toEqual(['Selling', 'definitions']);
    expect(() => TypedDataEncoder.hash({ name: 'test' }, attached as any, { data: { x: 'hello' } }))
      .not.toThrow();
  });

  test('the declaration is read from the symbol, not the colliding struct', () => {
    const attached = attachEip712Definitions(collidingMap(), collidingDeclaration);

    expect((eip712Definitions(attached) ?? []).map(d => d.name))
      .toEqual(['EIP712Domain', 'Selling', 'definitions']);
    expect(eip712TypesToAPI(attached).definitions?.map(d => d.name))
      .toEqual(['EIP712Domain', 'Selling', 'definitions']);
  });
});

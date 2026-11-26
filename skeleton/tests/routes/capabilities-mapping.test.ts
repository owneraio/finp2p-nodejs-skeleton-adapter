import { assetCreateResultToAPI, executionContextFromAPI, executionContextOptToAPI } from '../../src/routes/mapping';
import { components } from '../../src/routes/model-gen';
import { AssetCreationResult, ExecutionContext, InstructionCapability, ValidationError } from '../../src/models';

const apiContext = (contract?: string, contractFormat?: string): components['schemas']['executionContext'] => ({
  executionPlanId: 'plan-1',
  instructionSequenceNumber: 3,
  ...(contract !== undefined ? { contract } : {}),
  ...(contractFormat !== undefined ? { contractFormat } : {}),
} as components['schemas']['executionContext']);

const CONTRACT = '0xAbC0000000000000000000000000000000000001';
const CAIP10 = 'eip155:11155111:0xAbC0000000000000000000000000000000000001';

describe('executionContextFromAPI contract', () => {
  const cases: { name: string; input: string | undefined; expected: string | undefined }[] = [
    { name: 'keeps a contract', input: CONTRACT, expected: CONTRACT },
    { name: 'keeps a non-address service identifier', input: 'custody-api', expected: 'custody-api' },
    { name: 'drops an empty contract', input: '', expected: undefined },
    { name: 'drops a blank contract', input: '   ', expected: undefined },
    { name: 'leaves an absent contract absent', input: undefined, expected: undefined },
  ];

  test.each(cases)('$name', ({ input, expected }) => {
    const ctx = executionContextFromAPI(apiContext(input));
    expect(ctx.contract).toBe(expected);
    expect('contract' in ctx).toBe(expected !== undefined);
    expect(ctx.planId).toBe('plan-1');
    expect(ctx.sequence).toBe(3);
  });
});

describe('executionContextFromAPI contractFormat', () => {
  test.each([
    { format: 'caip10', contract: CAIP10 },
    { format: 'url', contract: 'https://gate.example/transfer' },
    { format: 'opaque', contract: 'custody-api' },
  ])('maps $format with its contract', ({ format, contract }) => {
    const ctx = executionContextFromAPI(apiContext(contract, format));

    expect(ctx.contract).toBe(contract);
    expect(ctx.contractFormat).toBe(format);
  });

  test('absent format stays absent', () => {
    const ctx = executionContextFromAPI(apiContext(CONTRACT));

    expect('contractFormat' in ctx).toBe(false);
  });

  test('a dropped blank contract takes its format with it', () => {
    const ctx = executionContextFromAPI(apiContext('  ', 'url'));

    expect('contract' in ctx).toBe(false);
    expect('contractFormat' in ctx).toBe(false);
  });

  test.each([
    { name: 'an unknown format', input: 'evm' },
    { name: 'a different case', input: 'URL' },
    { name: 'null', input: null },
    { name: 'a number', input: 7 },
    { name: 'an empty string', input: '' },
  ])('rejects $name with a validation error', ({ input }) => {
    const ep = { ...apiContext(CONTRACT), contractFormat: input } as unknown as components['schemas']['executionContext'];

    expect(() => executionContextFromAPI(ep)).toThrow(ValidationError);
  });

  test('is never emitted back on a receipt context', () => {
    const out = executionContextOptToAPI({ planId: 'plan-1', sequence: 3, contract: CONTRACT, contractFormat: 'caip10' });

    expect(out).toEqual({ executionPlanId: 'plan-1', instructionSequenceNumber: 3 });
  });
});

describe('executionContextFromAPI contract of the wrong type', () => {
  test.each([
    { name: 'null', input: null },
    { name: 'a number', input: 7 },
    { name: 'an object', input: {} },
  ])('rejects $name with a validation error', ({ input }) => {
    const ep = { ...apiContext(), contract: input } as unknown as components['schemas']['executionContext'];

    expect(() => executionContextFromAPI(ep)).toThrow(ValidationError);
  });
});

describe('executionContextOptToAPI contract', () => {
  const base: ExecutionContext = { planId: 'plan-1', sequence: 3 };
  const cases: { name: string; input: ExecutionContext }[] = [
    { name: 'context without a contract', input: base },
    { name: 'context with a contract', input: { ...base, contract: CONTRACT } },
  ];

  test.each(cases)('never emits contract: $name', ({ input }) => {
    const out = executionContextOptToAPI(input);
    expect(out).toEqual({ executionPlanId: 'plan-1', instructionSequenceNumber: 3 });
    expect(out).not.toHaveProperty('contract');
  });

  test('undefined context stays undefined', () => {
    expect(executionContextOptToAPI(undefined)).toBeUndefined();
  });
});

describe('assetCreateResultToAPI capabilities', () => {
  const ledgerIdentifier = { assetIdentifierType: 'CAIP-19', network: 'eip155:1', standard: 'ERC20', tokenId: '0x01' } as const;
  const result = (capabilities?: InstructionCapability[]): AssetCreationResult => ({
    ledgerIdentifier,
    reference: undefined,
    ...(capabilities !== undefined ? { capabilities } : {}),
  });

  const full: InstructionCapability[] = [
    {
      instruction: 'INSTRUCTION_TRANSFER',
      contracts: [
        {
          address: CAIP10,
          addressFormat: 'caip10',
          restrictions: { minAmount: '1', maxAmount: '1000' },
        },
        { address: 'https://custody.example/api', addressFormat: 'url' },
        { address: 'custody-api', addressFormat: 'opaque' },
      ],
    },
    { instruction: 'INSTRUCTION_ISSUE' },
    { instruction: 'INSTRUCTION_HOLD', contracts: [] },
  ];

  const cases: { name: string; input: InstructionCapability[] | undefined; expected: unknown; present: boolean }[] = [
    { name: 'undefined stays absent', input: undefined, expected: undefined, present: false },
    { name: 'empty list stays empty', input: [], expected: [], present: true },
    { name: 'full list round-trips', input: full, expected: full, present: true },
    {
      name: 'address and format survive without restrictions',
      input: [{ instruction: 'INSTRUCTION_SWAP', contracts: [{ address: CAIP10, addressFormat: 'caip10' }] }],
      expected: [{ instruction: 'INSTRUCTION_SWAP', contracts: [{ address: CAIP10, addressFormat: 'caip10' }] }],
      present: true,
    },
  ];

  test.each(cases)('$name', ({ input, expected, present }) => {
    const out = assetCreateResultToAPI(result(input));
    expect('capabilities' in out).toBe(present);
    expect(out.capabilities).toEqual(expected);
    expect(out.ledgerAssetInfo.ledgerIdentifier.network).toBe('eip155:1');
  });
});

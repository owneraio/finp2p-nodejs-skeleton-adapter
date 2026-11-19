import { LedgerAPI } from '@owneraio/finp2p-nodejs-skeleton-adapter';
import { LedgerAPIClient } from './api/api';
import { TestDataBuilder } from './utils/test-builders';
import { LedgerProfile, resolveLedgerProfile } from './utils/ledger-profile';
import { TestHelpers } from './utils/test-assertions';
import { TestFixtures } from './utils/test-fixtures';
import { ACTOR_NAMES, SCENARIOS } from './utils/test-constants';
import { generateId } from './utils/utils';

type Capabilities = LedgerAPI['schemas']['instructionCapabilities'][];

const INSTRUCTION_ID = /^INSTRUCTION_[A-Z0-9_]+$/;
const CONTRACT_NAME = /^[A-Za-z0-9._-]{1,64}$/;
const AMOUNT = /^[0-9]+(\.[0-9]+)?$/;
const TRANSFER = 'INSTRUCTION_TRANSFER';

/** Asserts a capability list follows the adapter API: ids, contract names, addresses, limits. */
const expectValidCapabilities = (capabilities: Capabilities) => {
  const instructions = capabilities.map(({ instruction }) => instruction);
  expect(new Set(instructions).size).toBe(instructions.length);
  const addressByName = new Map<string, string>();
  for (const { instruction, contracts } of capabilities) {
    expect(instruction).toMatch(INSTRUCTION_ID);
    expect(instruction).not.toBe('INSTRUCTION_AWAIT');
    for (const { name, address, description, restrictions } of contracts ?? []) {
      expect(name).toMatch(CONTRACT_NAME);
      expect(typeof address).toBe('string');
      expect(address.length).toBeGreaterThan(0);
      expect(addressByName.get(name) ?? address).toBe(address);
      addressByName.set(name, address);
      if (description !== undefined) {
        expect(typeof description).toBe('string');
      }
      for (const limit of [restrictions?.minAmount, restrictions?.maxAmount]) {
        if (limit !== undefined) {
          expect(limit).toMatch(AMOUNT);
        }
      }
    }
  }
};

/**
 * Opt-in suite for adapters that report asset capabilities. The adapter lists at least
 * one contract for `INSTRUCTION_TRANSFER` and refuses a transfer whose
 * `executionContext.contract` is not the address of a contract the asset lists.
 */
export function capabilitiesTests(ledger?: Partial<LedgerProfile>) {
  describe('Asset Capabilities', () => {

    let client: LedgerAPIClient;
    let builder: TestDataBuilder;
    let fixtures: TestFixtures;
    let orgId: string;

    const scenario = SCENARIOS.CAPABILITIES;

    beforeAll(async () => {
      // @ts-ignore
      client = new LedgerAPIClient(global.serverAddress, global.callbackServer, global.serverBaseAddress);
      // @ts-ignore
      orgId = global.orgId;

      builder = new TestDataBuilder(orgId, resolveLedgerProfile(ledger), client);
      fixtures = new TestFixtures(client, builder);
    });

    const createAsset = async () => {
      const asset = builder.buildFinP2PAsset();
      const created = await TestHelpers.createAssetAndWait(client, builder.buildCreateAssetRequest({ asset }));
      return { asset, created };
    };

    const transferContract = (capabilities: Capabilities) => {
      const contract = capabilities.find(({ instruction }) => instruction === TRANSFER)?.contracts?.[0];
      expect(contract).toBeDefined();
      return contract!.address;
    };

    const setupTransfer = async () => {
      const seller = await builder.buildActor(ACTOR_NAMES.SELLER);
      const buyer = await builder.buildActor(ACTOR_NAMES.BUYER);
      const { asset } = await fixtures.setupAssetWithBalance({ actor: seller, asset: builder.buildFinP2PAsset(), balance: scenario.ISSUED });
      const { capabilities } = await client.tokens.getCapabilities({ asset });
      return { seller, buyer, asset, capabilities };
    };

    const buildTransfer = (
      { seller, buyer, asset }: Awaited<ReturnType<typeof setupTransfer>>,
      contract: string,
    ) => builder.buildSignedTransferRequest({
      seller, buyer, asset, amount: scenario.AMOUNT, settlementAmount: scenario.SETTLEMENT_AMOUNT,
      executionContext: { executionPlanId: generateId(), instructionSequenceNumber: 1, contract },
    });

    test('create asset reports capabilities in the response', async () => {
      const { created } = await createAsset();

      expect(created.error).toBeUndefined();
      const capabilities = created.response?.capabilities;
      expect(capabilities).toBeDefined();
      expect(capabilities!.length).toBeGreaterThan(0);
      expectValidCapabilities(capabilities!);
      expect(transferContract(capabilities!)).not.toHaveLength(0);
    });

    test('getCapabilities returns the list reported at creation', async () => {
      const { asset, created } = await createAsset();

      const { capabilities } = await client.tokens.getCapabilities({ asset });

      expectValidCapabilities(capabilities);
      expect(capabilities).toStrictEqual(created.response?.capabilities);
    });

    test('getCapabilities for an unknown asset answers 404', async () => {
      const unknown = builder.buildFinP2PAsset();

      await expect(client.tokens.getCapabilities({ asset: unknown })).rejects.toMatch(/404/);
    });

    test('a transfer through a listed contract address executes and moves the funds', async () => {
      const setup = await setupTransfer();
      const { seller, buyer, asset, capabilities } = setup;

      const receipt = await TestHelpers.transferAndGetReceipt(client, await buildTransfer(setup, transferContract(capabilities)));

      expect(receipt.operationType).toBe('transfer');
      await client.expectBalance({ finId: seller.finId, asset }, scenario.ISSUED - scenario.AMOUNT);
      await client.expectBalance({ finId: buyer.finId, asset }, scenario.AMOUNT);
    });

    test('a transfer through an address the asset does not list is refused without moving funds', async () => {
      const setup = await setupTransfer();
      const { seller, buyer, asset } = setup;
      const request = await buildTransfer(setup, 'inmemory:not-listed');

      const result = await TestHelpers.executeAndWaitForCompletion(client, () => client.tokens.transfer(request));

      expect(result.error).toBeDefined();
      expect(result.response).toBeUndefined();
      await client.expectBalance({ finId: seller.finId, asset }, scenario.ISSUED);
      await client.expectBalance({ finId: buyer.finId, asset }, 0);
    });
  });
}

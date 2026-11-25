import { LedgerAPI } from '@owneraio/finp2p-nodejs-skeleton-adapter';
import { LedgerAPIClient } from './api/api';
import { TestDataBuilder } from './utils/test-builders';
import { LedgerProfile, resolveLedgerProfile } from './utils/ledger-profile';
import { TestHelpers } from './utils/test-assertions';
import { TestFixtures } from './utils/test-fixtures';
import { ACTOR_NAMES, SCENARIOS } from './utils/test-constants';
import { generateId } from './utils/utils';
import {
  CONTRACT_ADDRESS_FORMATS, isValidContractAddress, normalizeContractAddress, respellContractAddress, sameContract, unlistedContractAddress,
} from './utils/contract-address';

type Capabilities = LedgerAPI['schemas']['instructionCapabilities'][];
type Contract = LedgerAPI['schemas']['contractCapability'];

const INSTRUCTION_ID = /^INSTRUCTION_[A-Z0-9_]+$/;
const ADDRESS = /^\S(.*\S)?$/;
const AMOUNT = /^[0-9]+(\.[0-9]+)?$/;
const TRANSFER = 'INSTRUCTION_TRANSFER';

/** The address in the form the router compares; one that does not parse stays as written. */
const comparable = ({ address, addressFormat }: Contract) => normalizeContractAddress(address, addressFormat) ?? address;

/** The contract key the router compares: its format and the normalized address. */
const contractKey = (contract: Contract) => `${contract.addressFormat}|${comparable(contract)}`;

/** Asserts a capability list follows the adapter API: ids, contract addresses and formats, limits. */
const expectValidCapabilities = (capabilities: Capabilities) => {
  const instructions = capabilities.map(({ instruction }) => instruction);
  expect(new Set(instructions).size).toBe(instructions.length);
  for (const { instruction, contracts } of capabilities) {
    expect(instruction).toMatch(INSTRUCTION_ID);
    expect(instruction).not.toBe('INSTRUCTION_AWAIT');
    const keys = (contracts ?? []).map(contractKey);
    expect(new Set(keys).size).toBe(keys.length);
    for (const { address, addressFormat, restrictions } of contracts ?? []) {
      expect(address).toMatch(ADDRESS);
      expect(CONTRACT_ADDRESS_FORMATS).toContain(addressFormat);
      expect(isValidContractAddress(address, addressFormat)).toBe(true);
      for (const limit of [restrictions?.minAmount, restrictions?.maxAmount]) {
        if (limit !== undefined) {
          expect(limit).toMatch(AMOUNT);
        }
      }
    }
  }
};

/** Capabilities with every address in its normalized form, as the router would compare two lists. */
const normalized = (capabilities: Capabilities) => capabilities.map(({ instruction, contracts }) => ({
  instruction,
  contracts: contracts?.map((contract) => ({
    ...contract, address: comparable(contract),
  })),
}));

/**
 * Opt-in suite for adapters that report asset capabilities. When the adapter lists a
 * contract for `INSTRUCTION_TRANSFER` that admits the amount sent, it also runs a transfer through a listed
 * contract, through another spelling of it, and one through an unlisted address that must
 * be refused, comparing addresses the way the router does: normalized by format.
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

    const transferContracts = (capabilities: Capabilities): Contract[] =>
      capabilities.find(({ instruction }) => instruction === TRANSFER)?.contracts ?? [];

    /** The first TRANSFER contract whose limits admit the amount the tests send, compared as numbers. */
    const transferContract = (capabilities: Capabilities): Contract | undefined =>
      transferContracts(capabilities).find(({ restrictions }) =>
        (restrictions?.minAmount === undefined || scenario.AMOUNT >= Number(restrictions.minAmount))
        && (restrictions?.maxAmount === undefined || scenario.AMOUNT <= Number(restrictions.maxAmount)));

    /**
     * An adapter may list TRANSFER with no contracts, or only contracts whose limits exclude the
     * amount sent: there is then no contract to send, and the contract-transfer tests end here.
     */
    const skippedWithoutContract = (test: string, capabilities: Capabilities): void => {
      const reason = transferContracts(capabilities).length === 0
        ? `the adapter lists no contract for ${TRANSFER}, so there is no contract to send`
        : `no contract listed for ${TRANSFER} admits the amount ${scenario.AMOUNT}`;
      console.warn(`skipped "${test}": ${reason}`);
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
    });

    test('getCapabilities returns the list reported at creation', async () => {
      const { asset, created } = await createAsset();

      const { capabilities } = await client.tokens.getCapabilities({ asset });

      expectValidCapabilities(capabilities);
      expect(normalized(capabilities)).toStrictEqual(normalized(created.response?.capabilities ?? []));
    });

    test('getCapabilities for an unknown asset answers 404', async () => {
      const unknown = builder.buildFinP2PAsset();

      await expect(client.tokens.getCapabilities({ asset: unknown })).rejects.toMatch(/404/);
    });

    test('a transfer through a listed contract address executes and moves the funds', async () => {
      const setup = await setupTransfer();
      const { seller, buyer, asset, capabilities } = setup;
      const contract = transferContract(capabilities);
      if (!contract) {
        return skippedWithoutContract('a transfer through a listed contract address', capabilities);
      }

      const receipt = await TestHelpers.transferAndGetReceipt(client, await buildTransfer(setup, contract.address));

      expect(receipt.operationType).toBe('transfer');
      await client.expectBalance({ finId: seller.finId, asset }, scenario.ISSUED - scenario.AMOUNT);
      await client.expectBalance({ finId: buyer.finId, asset }, scenario.AMOUNT);
    });

    test('a transfer through another spelling of a listed address executes', async () => {
      const setup = await setupTransfer();
      const { seller, buyer, asset, capabilities } = setup;
      const contract = transferContract(capabilities);
      if (!contract) {
        return skippedWithoutContract('a transfer through another spelling of a listed address', capabilities);
      }
      const { address, addressFormat } = contract;
      const respelled = respellContractAddress(address, addressFormat);
      if (respelled === address) {
        // opaque addresses have a single spelling, so there is nothing to compare
        return;
      }
      expect(sameContract({ address: respelled, addressFormat }, { address, addressFormat })).toBe(true);

      const receipt = await TestHelpers.transferAndGetReceipt(client, await buildTransfer(setup, respelled));

      expect(receipt.operationType).toBe('transfer');
      await client.expectBalance({ finId: seller.finId, asset }, scenario.ISSUED - scenario.AMOUNT);
      await client.expectBalance({ finId: buyer.finId, asset }, scenario.AMOUNT);
    });

    test('a transfer through an address the asset does not list is refused without moving funds', async () => {
      const setup = await setupTransfer();
      const { seller, buyer, asset, capabilities } = setup;
      const contract = transferContract(capabilities);
      if (!contract) {
        return skippedWithoutContract('a transfer through an address the asset does not list', capabilities);
      }
      // well formed for its format, so only a check against the list can refuse it
      const unlisted = unlistedContractAddress(contract, generateId());
      expect(isValidContractAddress(unlisted, contract.addressFormat)).toBe(true);
      for (const listed of transferContracts(capabilities)) {
        expect(sameContract({ address: unlisted, addressFormat: contract.addressFormat }, listed)).toBe(false);
      }
      const request = await buildTransfer(setup, unlisted);

      const result = await TestHelpers.executeAndWaitForCompletion(client, () => client.tokens.transfer(request));

      expect(result.error).toBeDefined();
      expect(result.response).toBeUndefined();
      await client.expectBalance({ finId: seller.finId, asset }, scenario.ISSUED);
      await client.expectBalance({ finId: buyer.finId, asset }, 0);
    });
  });
}

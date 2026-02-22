import { createCrypto, generateNonce, randomResourceId, ASSET } from './utils';
import { LedgerAPI } from '@owneraio/finp2p-nodejs-skeleton-adapter';
import { eip712Signature } from '../api/mapper';
import {
  EIP712PrimarySaleMessage,
  EIP712SellingMessage,
  eip712Term,
  finId,
  newRedemptionMessage,
  newSellingMessage,
  PRIMARY_SALE_TYPES,
  REDEMPTION_TYPES,
  SELLING_TYPES,
} from '@owneraio/finp2p-adapter-models';

/**
 * Represents a test actor (user/participant) with cryptographic keys and account info
 */
export interface TestActor {
  name: string;
  privateKey: string;
  finId: string;
  depositAccount: LedgerAPI['schemas']['depositPayoutAccount'];
}

/**
 * Builder class for creating test data objects and request bodies
 *
 * Naming convention:
 * - build[DataType]() - Creates supporting data objects (actors, assets, etc.)
 * - build[Operation]Request() - Creates request body objects for API calls
 */
export class TestDataBuilder {
  constructor(
    private orgId: string,
    private chainId: number,
    private verifyingContract: string,
  ) {}

  // ========== Data Builders (creates supporting objects) ==========

  /**
   * Creates a test actor with generated keys and account
   * @example const alice = builder.buildActor('alice');
   */
  buildActor(name: string = 'actor'): TestActor {
    const { private: privateKeyBytes, public: publicKey } = createCrypto();
    const privateKey = privateKeyBytes.toString('hex');
    const finIdStr = publicKey.toString('hex');

    return {
      name,
      privateKey,
      finId: finIdStr,
      depositAccount: {
        finId: finIdStr,
        account: {
          type: 'finId',
          finId: finIdStr,
        },
      },
    };
  }

  /**
   * Creates a FinP2P asset with a random resource ID
   * @example const asset = builder.buildFinP2PAsset();
   */
  buildFinP2PAsset(): LedgerAPI['schemas']['asset'] {
    const assetId = randomResourceId(this.orgId, ASSET);
    return { resourceId: assetId };
  }

  /**
   * Creates a fiat asset represented as a finp2p asset using the currency code as resourceId
   * @example const usd = builder.buildFiatAsset('USD');
   */
  buildFiatAsset(code: string = 'USD'): LedgerAPI['schemas']['asset'] {
    return { resourceId: code };
  }

  // ========== Request Builders (creates request body objects) ==========

  /**
   * Creates a CreateAssetRequest body for API call
   * @example await client.tokens.createAsset(builder.buildCreateAssetRequest({ asset }));
   */
  buildCreateAssetRequest(params: {
    asset: LedgerAPI['schemas']['asset'];
  }): LedgerAPI['schemas']['CreateAssetRequest'] {
    return {
      asset: params.asset,
    };
  }

  /**
   * Creates a signed IssueAssetsRequest body for primary sale
   * @example await client.tokens.issue(builder.buildSignedIssueRequest({ ... }));
   */
  async buildSignedIssueRequest(params: {
    buyer: TestActor;
    issuer: TestActor;
    asset: LedgerAPI['schemas']['finp2pAsset'];
    amount: number;
    settlementAmount: number;
    settlementAssetCode?: string;
  }): Promise<LedgerAPI['schemas']['IssueAssetsRequest']> {
    const nonce = generateNonce().toString('hex');
    const settlementAssetCode = params.settlementAssetCode || 'USD';

    return {
      nonce,
      destination: { finId: params.issuer.finId, asset: params.asset },
      quantity: `${params.amount}`,
      settlementRef: '',
      signature: await eip712Signature(
        this.chainId,
        this.verifyingContract,
        'PrimarySale',
        PRIMARY_SALE_TYPES,
        {
          nonce,
          buyer: { idkey: params.buyer.finId },
          issuer: { idkey: params.issuer.finId },
          asset: {
            assetId: params.asset.resourceId,
            assetType: 'finp2p',
            amount: `${params.amount}`,
          },
          settlement: {
            assetId: settlementAssetCode,
            assetType: 'fiat',
            amount: `${params.settlementAmount}`,
          },
        } as EIP712PrimarySaleMessage,
        params.buyer.privateKey,
      ),
    };
  }

  /**
   * Creates a simple IssueAssetsRequest body without signature (for testing/setup)
   * @example await client.tokens.issue(builder.buildIssueRequest({ ... }));
   */
  buildIssueRequest(params: {
    destination: LedgerAPI['schemas']['account'];
    quantity: number;
    settlementRef?: string;
  }): LedgerAPI['schemas']['IssueAssetsRequest'] {
    return {
      nonce: generateNonce().toString('hex'),
      destination: params.destination,
      quantity: `${params.quantity}`,
      settlementRef: params.settlementRef || '',
      signature: {} as LedgerAPI['schemas']['signature'],
    };
  }

  /**
   * Creates a signed TransferAssetRequest body
   * @example await client.tokens.transfer(builder.buildSignedTransferRequest({ ... }));
   */
  async buildSignedTransferRequest(params: {
    seller: TestActor;
    buyer: TestActor;
    asset: LedgerAPI['schemas']['finp2pAsset'];
    amount: number;
    settlementAmount: number;
    settlementAssetCode?: string;
  }): Promise<LedgerAPI['schemas']['TransferAssetRequest']> {
    const nonce = generateNonce().toString('hex');
    const settlementAssetCode = params.settlementAssetCode || 'USD';

    return {
      nonce,
      source: { finId: params.seller.finId, asset: params.asset },
      destination: { finId: params.buyer.finId, asset: params.asset },
      quantity: `${params.amount}`,
      settlementRef: '',
      signature: await eip712Signature(
        this.chainId,
        this.verifyingContract,
        'Selling',
        SELLING_TYPES,
        {
          nonce,
          seller: { idkey: params.seller.finId },
          buyer: { idkey: params.buyer.finId },
          asset: {
            assetId: params.asset.resourceId,
            assetType: 'finp2p',
            amount: `${params.amount}`,
          },
          settlement: {
            assetId: settlementAssetCode,
            assetType: 'fiat',
            amount: `${params.settlementAmount}`,
          },
        } as EIP712SellingMessage,
        params.seller.privateKey,
      ),
    };
  }

  /**
   * Creates a signed HoldOperationRequest body for escrow
   * @example await client.escrow.hold(builder.buildSignedHoldRequest({ ... }));
   */
  async buildSignedHoldRequest(params: {
    source: TestActor;
    destination: TestActor;
    asset: LedgerAPI['schemas']['asset'];
    assetId: string;
    amount: number;
    settlementAmount: number;
    operationId: string;
    expiry?: number;
  }): Promise<LedgerAPI['schemas']['HoldOperationRequest']> {
    const nonce = generateNonce().toString('hex');

    return {
      nonce,
      operationId: params.operationId,
      source: { finId: params.source.finId, asset: params.asset },
      destination: { finId: params.destination.finId, asset: params.asset },
      quantity: `${params.settlementAmount}`,
      expiry: params.expiry || 0,
      signature: await eip712Signature(
        this.chainId,
        this.verifyingContract,
        'Selling',
        SELLING_TYPES,
        newSellingMessage(
          nonce,
          finId(params.source.finId),
          finId(params.destination.finId),
          eip712Term(params.assetId, 'finp2p', `${params.amount}`),
          eip712Term('USD', 'fiat', `${params.settlementAmount}`),
        ),
        params.source.privateKey,
      ),
    };
  }

  /**
   * Creates signed hold and redeem request bodies for redemption flow
   * @example const { holdRequest, redeemRequest } = await builder.buildRedeemRequests({ ... });
   */
  async buildRedeemRequests(params: {
    investor: TestActor;
    issuer: TestActor;
    asset: LedgerAPI['schemas']['finp2pAsset'];
    amount: number;
    settlementAmount: number;
    operationId: string;
  }): Promise<{
      holdRequest: LedgerAPI['schemas']['HoldOperationRequest'];
      redeemRequest: LedgerAPI['schemas']['RedeemAssetsRequest'];
    }> {
    const nonce = generateNonce().toString('hex');

    const signature = await eip712Signature(
      this.chainId,
      this.verifyingContract,
      'Redemption',
      REDEMPTION_TYPES,
      newRedemptionMessage(
        nonce,
        finId(params.issuer.finId),
        finId(params.investor.finId),
        eip712Term(params.asset.resourceId, 'finp2p', `${params.amount}`),
        eip712Term('USD', 'fiat', `${params.settlementAmount}`),
      ),
      params.investor.privateKey,
    );

    return {
      holdRequest: {
        nonce,
        operationId: params.operationId,
        source: { finId: params.investor.finId, asset: params.asset },
        quantity: `${params.amount}`,
        expiry: 0,
        signature,
      },
      redeemRequest: {
        nonce,
        operationId: params.operationId,
        source: { finId: params.investor.finId, asset: params.asset },
        quantity: `${params.amount}`,
        settlementRef: '',
        signature,
      },
    };
  }

  /**
   * Creates a ReleaseOperationRequest body for releasing escrowed assets
   * @example await client.escrow.release(builder.buildReleaseRequest({ ... }));
   */
  buildReleaseRequest(params: {
    source: TestActor;
    destination: TestActor;
    asset: LedgerAPI['schemas']['asset'];
    quantity: number;
    operationId: string;
  }): LedgerAPI['schemas']['ReleaseOperationRequest'] {
    return {
      operationId: params.operationId,
      source: { finId: params.source.finId, asset: params.asset },
      destination: { finId: params.destination.finId, asset: params.asset },
      quantity: `${params.quantity}`,
    };
  }

  /**
   * Creates a DepositInstructionRequest body
   * @example await client.payments.getDepositInstruction(builder.buildDepositInstructionRequest({ ... }));
   */
  buildDepositInstructionRequest(params: {
    owner: TestActor;
    destination: TestActor;
    asset: LedgerAPI['schemas']['depositAsset'];
  }): LedgerAPI['schemas']['DepositInstructionRequest'] {
    return {
      owner: params.owner.depositAccount,
      destination: params.destination.depositAccount,
      asset: params.asset,
    };
  }
}

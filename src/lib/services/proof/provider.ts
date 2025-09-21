import { Receipt } from '../model';
import { FinP2PClient } from '@owneraio/finp2p-client';
import { DOMAIN_TYPE, RECEIPT_PROOF_TYPES } from '../eip712';
import { EIP712_DOMAIN, hashEIP712, logger, signEIP712WithPrivateKey } from '../../helpers';
import { receiptToEIP712Message } from './mappers';


export class ProofProvider {

  finP2PClient: FinP2PClient | undefined;

  signerPrivateKey: string;


  constructor(finP2PClient: FinP2PClient | undefined, signerPrivateKey: string) {
    this.finP2PClient = finP2PClient;
    this.signerPrivateKey = signerPrivateKey;
  }

  async ledgerProof(receipt: Receipt): Promise<Receipt> {
    if (this.finP2PClient === undefined) {
      return receipt;
    }
    const { asset: { assetId, assetType } } = receipt;
    const policy = await this.finP2PClient.getAssetProofPolicy(assetId, assetType);
    switch (policy.type) {
      case 'NoProofPolicy':
        receipt.proof = {
          type: 'no-proof',
        };
        return receipt;

      case 'SignatureProofPolicy':
        const { signatureTemplate, domain: policyDomain } = policy;
        if (signatureTemplate !== 'EIP712') {
          throw new Error(`Unsupported signature template: ${signatureTemplate}`);
        }
        if (policyDomain !== null) {
          logger.info('Using domain from asset metadata: ', policyDomain);
        }
        const { chainId, verifyingContract } = EIP712_DOMAIN;
        const types = RECEIPT_PROOF_TYPES;
        const message = receiptToEIP712Message(receipt);
        const primaryType = 'Receipt';

        logger.info('Signing receipt with EIP712', { primaryType, types, message });
        const hash = hashEIP712(chainId, verifyingContract, types, message);
        const signature = await signEIP712WithPrivateKey(chainId, verifyingContract, types, message, this.signerPrivateKey);

        logger.info('Receipt signed', { hash, signature });

        // ethers doesn't allow to pass an eip712 domain in a list of types, but the domain is required on a router side
        receipt.proof = {
          type: 'signature-proof',
          template: {
            type: 'EIP712',
            primaryType,
            domain: EIP712_DOMAIN,
            types: { ...DOMAIN_TYPE, ...types },
            hash,
            message,
          },
          signature,
          hashFunc: 'keccak-256',
        };

        return receipt;
    }
  }
}

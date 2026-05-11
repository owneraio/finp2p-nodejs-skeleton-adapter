import { Signature } from '../models';
import { logger, hashEIP712, verifyEIP712, verifySecp } from '../helpers';


/**
 * Identifier needed to verify a signature.
 *
 * - `finId`: the FinP2P account id (used by the secp256k1 / hashList branch,
 *   which treats it as a compressed pubkey hex).
 * - `ledgerAccountId`: the ledger account (e.g. Ethereum 0x… address) bound
 *   to that finId via AccountMappingService — required by the EIP712 branch.
 *
 * Callers are expected to resolve `ledgerAccountId` from the mapping before
 * invoking this verifier. The skeleton no longer derives an address from
 * the finId itself.
 */
export interface SignerRef {
  finId: string;
  ledgerAccountId?: string;
}

export const verifySignature = async (sgn: Signature, signer: SignerRef): Promise<boolean> => {
  const { signature, template } = sgn;

  switch (template.type) {
    case 'EIP712': {
      if (!signer.ledgerAccountId) {
        logger.warning('EIP712 verification requires signer.ledgerAccountId (bound via AccountMappingService)');
        return false;
      }
      const { domain: { chainId, verifyingContract }, message, types, hash: actualHash } = template;

      const expectedHash = hashEIP712(chainId, verifyingContract, types, message);
      if (actualHash !== expectedHash) {
        logger.warning(`EIP712 hash mismatch: expected ${expectedHash}, got ${actualHash}`);
        return false;
      }

      if (!verifyEIP712(chainId, verifyingContract, types, message, signer.ledgerAccountId, `0x${signature}`)) {
        logger.warning('EIP712 signature not verified');
        return false;
      }
      return true;
    }
    case 'hashList': {
      const { hash } = template;
      if (!verifySecp(
        Buffer.from(hash, 'hex'),
        Buffer.from(signature, 'hex'),
        Buffer.from(signer.finId, 'hex'),
      )) {
        logger.warning('hashList signature not verified');
        return false;
      }

      return true;
    }
  }

};



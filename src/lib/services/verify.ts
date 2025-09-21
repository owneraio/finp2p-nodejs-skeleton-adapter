import { hashEIP712, verifyEIP712 } from '../helpers';
import { logger } from '../helpers';
import { Signature } from './index';
import { verifySecp } from '../helpers/hashList';


export const verifySignature = async (sgn: Signature, signerFinId: string): Promise<boolean> => {
  const { signature, template, hashFunc } = sgn;

  switch (template.type) {
    case 'EIP712': {
      const { domain: { chainId, verifyingContract }, message, types, hash: actualHash } = template;

      const expectedHash = hashEIP712(chainId, verifyingContract, types, message);
      if (actualHash !== expectedHash) {
        logger.warn(`EIP712 hash mismatch: expected ${expectedHash}, got ${actualHash}`);
        return false;
      }

      if (!verifyEIP712(chainId, verifyingContract, types, message, signerFinId, `0x${signature}`)) {
        logger.warn('EIP712 signature not verified');
        return false;
      }
      return true;

    }
    case 'hashList': {
      const { hash } = template;
      if (!verifySecp(
        Buffer.from(hash, 'hex'),
        Buffer.from(signature, 'hex'),
        Buffer.from(signerFinId, 'hex'),
      )) {
        logger.warn('hashList signature not verified');
        return false;
      }

      logger.warn(`Unsupported signature type: ${template.type}`);
      return true;

    }
  }

};



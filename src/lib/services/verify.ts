import {hashEIP712, verifyEIP712} from "../helpers";
import {logger} from "../helpers";
import {Signature} from "./index";


export const verifySignature = async (sgn: Signature, signerFinId: string): Promise<boolean> => {
  const {signature, template} = sgn;

  if (template.type === 'EIP712') {
    const {domain: {chainId, verifyingContract}, message, types, hash: actualHash} = template;

    const expectedHash = hashEIP712(chainId, verifyingContract, types, message)
    if (actualHash !== expectedHash) {
      logger.warn(`EIP712 hash mismatch: expected ${expectedHash}, got ${actualHash}`);
      return false
    }

    if (!verifyEIP712(chainId, verifyingContract, types, message, signerFinId, `0x${signature}`)) {
      logger.warn("EIP712 signature not verified");
      return false
    }
  } else {
    logger.warn(`Unsupported signature type: ${template.type}`);
  }

  return true
}



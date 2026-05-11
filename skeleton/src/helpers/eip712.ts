import { Signer, TypedDataEncoder, verifyTypedData, Wallet, TypedDataField } from 'ethers';


export const EIP712_DOMAIN = {
  name: 'FinP2P',
  version: '1',
  chainId: 1,
  verifyingContract: '0x0000000000000000000000000000000000000000',
};

export const signEIP712 = (chainId: bigint | number, verifyingContract: string, types: Record<string, Array<TypedDataField>>, message: Record<string, any>, signer: Signer) => {
  const domain = { ...EIP712_DOMAIN, chainId, verifyingContract };
  return signer.signTypedData(domain, types, message);
};

export const signEIP712WithPrivateKey = (chainId: bigint | number, verifyingContract: string, types: Record<string, Array<TypedDataField>>, message: Record<string, any>, signerPrivateKey: string) => {
  return signEIP712(chainId, verifyingContract, types, message, new Wallet(signerPrivateKey));
};

export const hashEIP712 = (chainId: bigint | number, verifyingContract: string, types: Record<string, Array<TypedDataField>>, message: Record<string, any>) => {
  const domain = { ...EIP712_DOMAIN, chainId, verifyingContract };
  return TypedDataEncoder.hash(domain, types, message);
};

/**
 * Verify an EIP712 signature against the expected signer address.
 *
 * `signerAddress` is the ledger account bound to the signer's finId via
 * the AccountMappingService (`ledgerAccountId` field) — NOT a value
 * derived from the finId itself. Callers are responsible for resolving
 * the mapping before invoking this verifier.
 */
export const verifyEIP712 = (chainId: bigint | number, verifyingContract: string, types: Record<string, Array<TypedDataField>>, message: Record<string, any>, signerAddress: string, signature: string) => {
  const domain = { ...EIP712_DOMAIN, chainId, verifyingContract };
  const recovered = verifyTypedData(domain, types, message, signature);
  return recovered.toLowerCase() === signerAddress.toLowerCase();
};


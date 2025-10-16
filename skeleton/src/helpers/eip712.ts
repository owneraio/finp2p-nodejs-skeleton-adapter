import { Signer, TypedDataEncoder, verifyTypedData, Wallet, TypedDataField, computeAddress } from 'ethers';


export const EIP712_DOMAIN = {
  name: 'FinP2P',
  version: '1',
  chainId: 1,
  verifyingContract: '0x0000000000000000000000000000000000000000',
};

export const finIdToAddress = (finId: string): string => {
  return computeAddress(`0x${finId}`);
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

export const verifyEIP712 = (chainId: bigint | number, verifyingContract: string, types: Record<string, Array<TypedDataField>>, message: Record<string, any>, signerFinId: string, signature: string) => {
  const signerAddress = finIdToAddress(signerFinId);
  const domain = { ...EIP712_DOMAIN, chainId, verifyingContract };
  const address = verifyTypedData(domain, types, message, signature);
  return address.toLowerCase() === signerAddress.toLowerCase();
};


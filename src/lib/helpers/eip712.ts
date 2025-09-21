import {Signer, TypedDataEncoder, verifyTypedData, Wallet, TypedDataField} from "ethers";


export const DOMAIN = {
  name: "FinP2P",
  version: "1",
  chainId: 1,
  verifyingContract: "0x0"
};

export const signWithPrivateKey = (chainId: bigint | number, verifyingContract: string, types: Record<string, Array<TypedDataField>>, message: Record<string, any>, signerPrivateKey: string) => {
  return sign(chainId, verifyingContract, types, message, new Wallet(signerPrivateKey));
};

export const sign = (chainId: bigint | number, verifyingContract: string, types: Record<string, Array<TypedDataField>>, message: Record<string, any>, signer: Signer) => {
  const domain = {...DOMAIN, chainId, verifyingContract};
  return signer.signTypedData(domain, types, message);
};

export const hash = (chainId: bigint | number, verifyingContract: string, types: Record<string, Array<TypedDataField>>, message: Record<string, any>) => {
  const domain = {...DOMAIN, chainId, verifyingContract};
  return TypedDataEncoder.hash(domain, types, message);
};

export const verify = (chainId: bigint | number, verifyingContract: string, types: Record<string, Array<TypedDataField>>, message: Record<string, any>, signerAddress: string, signature: string) => {
  const domain = {...DOMAIN, chainId, verifyingContract};
  const address = verifyTypedData(domain, types, message, signature);
  return address.toLowerCase() === signerAddress.toLowerCase();
};


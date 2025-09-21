import {
  EIP712Message,
  eip712MessageToAPI,
  EIP712Types,
  eip712TypesToAPI,
  hashEIP712,
  LedgerAPI,
  signEIP712WithPrivateKey
} from "../../src";

export const eip712Signature = async (chainId: number,
                                      verifyingContract: string, primaryType: string,
                                      types: EIP712Types, message: EIP712Message, signerPrivateKey: string): Promise<LedgerAPI["schemas"]["signature"]> => {
  const hashVal = hashEIP712(chainId, verifyingContract, types, message);
  const signature = await signEIP712WithPrivateKey(chainId, verifyingContract, types, message, signerPrivateKey);
  return {
    signature: signature.replace("0x", ""),
    template: {
      type: "EIP712",
      domain: {
        name: "FinP2P",
        version: "1", chainId, verifyingContract
      },
      primaryType,
      types: eip712TypesToAPI(types),
      message: eip712MessageToAPI(message),
      hash: hashVal
    },
    hashFunc: "keccak_256"
  };
};




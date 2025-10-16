import {
  AssetGroup,
  EIP712Message,
  eip712MessageToAPI,
  EIP712Types,
  eip712TypesToAPI,
  hashEIP712,
  LedgerAPI, SettlementGroup,
  signEIP712WithPrivateKey
} from "@owneraio/finp2p-nodejs-skeleton-adapter";
import {hashBufferValues, hashValues, signSecp} from "@owneraio/finp2p-nodejs-skeleton-adapter/dist/lib/helpers/hashList";

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

const hashFields = (fields: LedgerAPI["schemas"]['field'][], hashFunc: string): Buffer => {
  let values: any = [];
  for (let f of fields) {
    switch (f.type) {
      case "bytes":
        values.push(Buffer.from(f.value, "hex"));
        break;
      case "string":
        values.push(f.value);
        break;
    }
  }

  return hashValues(values, hashFunc);
};

export const hashListSignature = (
  asset: AssetGroup,
  settlement: SettlementGroup,
  hashFunc: "sha3-256" | "keccak-256",
  signerPrivateKey: String
): LedgerAPI["schemas"]["signature"] => {
  const hashGroups: LedgerAPI["schemas"]['hashGroup'][] = [];
  const hashes: Buffer[] = [];
  if (asset) {
    const {nonce, source, destination, asset: {assetId, assetType}, quantity, operation} = asset;
    let fields: LedgerAPI["schemas"]['field'][] = [];
    fields.push({name: "nonce", type: "bytes", value: nonce});
    fields.push({name: "operation", type: "string", value: operation});
    fields.push({name: "assetType", type: "string", value: assetType});
    fields.push({name: "assetId", type: "string", value: assetId});
    if (source) {
      const {finId, type} = source;
      fields.push({name: "srcAccountType", type: "string", value: type});
      fields.push({name: "srcAccount", type: "string", value: finId});
    }
    if (destination) {
      const {finId, type} = destination;
      fields.push({name: "dstAccountType", type: "string", value: type});
      fields.push({name: "dstAccount", type: "string", value: finId});
    }
    fields.push({name: "amount", type: "string", value: quantity});
    const hash = hashFields(fields, hashFunc);
    hashGroups.push({hash: hash.toString("hex"), fields});
    hashes.push(hash);
  }

  if (settlement) {
    const {source, destination, asset: {assetId, assetType}, quantity, expiry} = settlement;
    let fields: LedgerAPI["schemas"]['field'][] = [];
    fields.push({name: "assetType", type: "string", value: assetType});
    fields.push({name: "assetId", type: "string", value: assetId});
    if (source) {
      const {finId, type} = source;
      fields.push({name: "srcAccountType", type: "string", value: type});
      fields.push({name: "srcAccount", type: "string", value: finId});
    }
    if (destination) {
      const {finId, type} = destination;
      fields.push({name: "dstAccountType", type: "string", value: type});
      fields.push({name: "dstAccount", type: "string", value: finId});
    }
    fields.push({name: "amount", type: "string", value: `${quantity}`});
    if (expiry > 0) {
      fields.push({name: "expiry", type: "string", value: `${expiry}`});
    }

    const hash = hashFields(fields, hashFunc);
    hashGroups.push({hash: hash.toString("hex"), fields});
    hashes.push(hash);
  }

  const hash = hashBufferValues(hashes, hashFunc);
  return {
    signature: signSecp(Buffer.from(signerPrivateKey, "hex"), hash),
    template: {
      type: 'hashList',
      hash: hash.toString("hex"),
      hashGroups: hashGroups
    },
    hashFunc
  };
};

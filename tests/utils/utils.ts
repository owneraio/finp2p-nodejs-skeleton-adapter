import * as secp256k1 from "secp256k1";
import * as crypto from "crypto";
import {v4 as uuidv4} from "uuid";
import createKeccakHash from "keccak";
import {components} from "../../src/lib/routes/model-gen";

export const ASSET = 102;

export const createCrypto = (): { private: Buffer, public: Buffer } => {
  // generate privKey
  let privKey;
  do {
    privKey = crypto.randomBytes(32);
  } while (!secp256k1.privateKeyVerify(privKey));

  // get the public key in a compressed format
  const pubKey = secp256k1.publicKeyCreate(privKey, true);
  return {private: privKey, public: pubKey};
};

export const generateNonce = () => {
  const buffer = Buffer.alloc(32);
  const randomBytes = crypto.randomBytes(24);

  // @ts-ignore
  buffer.fill(randomBytes, 0, 24);

  const nowEpochSeconds = Math.floor(new Date().getTime() / 1000);
  const t = BigInt(nowEpochSeconds);
  buffer.writeBigInt64BE(t, 24);

  return buffer;
};

export const randomResourceId = (orgId: string, resourceType: number) => {
  return `${orgId}:${resourceType}:${uuidv4()}`;
};

export const randomPort = () => {
  return Math.floor(Math.random() * 10000) + 10000;
}

export interface AssetGroup {
  nonce: Buffer;
  operation: string;
  source?: components["schemas"]["source"];
  destination?: components["schemas"]["destination"];
  quantity: number;
  asset: components["schemas"]["asset"];
}

export interface SettlementGroup {
  asset: components["schemas"]["asset"];
  source?: components["schemas"]["source"];
  destination?: components["schemas"]["destination"];
  quantity: number;
  expiry: number;
}

export const transferSignature = (
  assetGroup: AssetGroup, settlementGroup: SettlementGroup,
  hashFunc: "sha3-256" | "keccak-256", privateKey: Buffer): components["schemas"]["signature"] => {
  const hashGroups: components["schemas"]['hashGroup'][] = [];
  const hashes: Buffer[] = [];
  if (assetGroup !== undefined) {
    let assetFields: components["schemas"]['field'][] = [];
    assetFields.push({name: "nonce", type: "bytes", value: assetGroup.nonce.toString("hex")});
    assetFields.push({name: "operation", type: "string", value: assetGroup.operation});
    assetFields.push({name: "assetType", type: "string", value: assetGroup.asset.type});
    assetFields.push({name: "assetId", type: "string", value: extractIdFromAsset(assetGroup.asset)});
    if (assetGroup.source !== undefined) {
      assetFields.push({name: "srcAccountType", type: "string", value: assetGroup.source.account.type});
      assetFields.push({
        name: "srcAccount",
        type: "string",
        value: extractIdFromSource(assetGroup.source.account)
      });
    }
    if (assetGroup.destination !== undefined) {
      assetFields.push({name: "dstAccountType", type: "string", value: assetGroup.destination.account.type});
      assetFields.push({
        name: "dstAccount",
        type: "string",
        value: extractIdFromDestination(assetGroup.destination.account)
      });
    }
    assetFields.push({name: "amount", type: "string", value: `${assetGroup.quantity}`});
    let assetHash = hashFields(assetFields, hashFunc);
    hashGroups.push({
      hash: assetHash.toString("hex"),
      fields: assetFields
    });
    hashes.push(assetHash);
  }

  if (settlementGroup !== undefined) {
    let settlementFields: components["schemas"]['field'][] = [];
    settlementFields.push({name: "assetType", type: "string", value: settlementGroup.asset.type});
    settlementFields.push({name: "assetId", type: "string", value: extractIdFromAsset(settlementGroup.asset)});
    if (settlementGroup.source !== undefined) {
      settlementFields.push({name: "srcAccountType", type: "string", value: settlementGroup.source.account.type});
      settlementFields.push({
        name: "srcAccount",
        type: "string",
        value: extractIdFromSource(settlementGroup.source.account)
      });
    }
    if (settlementGroup.destination !== undefined) {
      settlementFields.push({
        name: "dstAccountType",
        type: "string",
        value: settlementGroup.destination.account.type
      });
      settlementFields.push({
        name: "dstAccount",
        type: "string",
        value: extractIdFromDestination(settlementGroup.destination.account)
      });
    }
    settlementFields.push({
      name: "amount",
      type: "string",
      value: `${settlementGroup.quantity}`
    });
    if (settlementGroup.expiry > 0) {
      settlementFields.push({
        name: "expiry",
        type: "string",
        value: `${settlementGroup.expiry}`
      });
    }

    let settlementHash = hashFields(settlementFields, hashFunc);
    hashGroups.push({
      hash: settlementHash.toString("hex"),
      fields: settlementFields
    });
    hashes.push(settlementHash);
  }

  const hash = hashBufferValues(hashes, hashFunc);
  return {
    signature: sign(privateKey, hash),
    template: {
      type: 'hashList',
      hash: hash.toString("hex"),
      hashGroups: hashGroups
    },
    hashFunc
  };
};

export const hashFields = (fields: components["schemas"]['field'][], hashFunc: string): Buffer => {
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

const extractIdFromAsset = (asset: components["schemas"]['asset']): string => {
  switch (asset.type) {
    case "finp2p":
      return asset.resourceId;
    case "cryptocurrency":
    case "fiat":
      return asset.code;
  }
};

const extractIdFromSource = (account: components["schemas"]['finIdAccount']): string => {
  switch (account.type) {
    case "finId":
      return account.finId;
  }
};

const extractIdFromDestination = (account: components["schemas"]['finIdAccount'] |
  components["schemas"]['cryptoWalletAccount'] |
  components["schemas"]['fiatAccount'] | undefined): string => {
  if (account === undefined) {
    return "";
  }
  switch (account?.type) {
    case "finId":
      return account.finId;
    case "cryptoWallet":
      return account.address;
    case "fiatAccount":
      return account.code;
  }
};


type HashFunction = string;
let HashFunction = {
  SHA3_256: "sha3-256",
  BLAKE2B: "blake2b",
  KECCAK_256: "keccak-256"
};


export const hashValues = (values: any[], hashFunc: HashFunction = HashFunction.SHA3_256) => {
  return hashBufferValues(values.map(Buffer.from), hashFunc);
};

export const hashBufferValues = (values: Buffer[], hashFunc: HashFunction = HashFunction.SHA3_256) => {
  let hashFn: crypto.Hash;
  switch (hashFunc) {
    case HashFunction.SHA3_256:
      hashFn = crypto.createHash(HashFunction.SHA3_256);
      break;
    case HashFunction.KECCAK_256:
      // @ts-ignore
      hashFn = createKeccakHash("keccak256");
      break;
    default:
      throw Error("unsupported hash function : " + hashFunc);
  }

  values.forEach((v) => {
    // @ts-ignore
    hashFn.update(v);
  });

  return hashFn.digest();
};

export const sign = (privKey: Buffer, hash: Buffer) => {
  const sigObj = secp256k1.sign(hash, privKey);
  return sigObj.signature.toString("hex");
};

export const verify = (mes: Buffer, signature: Buffer, pubKey: Buffer) => {
  return secp256k1.verify(mes, signature, pubKey);
};

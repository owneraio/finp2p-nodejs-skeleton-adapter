import crypto from 'crypto';
import createKeccakHash from 'keccak';
import * as secp256k1 from 'secp256k1';


export const hashBufferValues = (values: Buffer[], hashFunc: string) => {
  let hashFn: crypto.Hash;
  switch (hashFunc) {
    case  'sha3_256':
    case 'sha3-256':
      hashFn = crypto.createHash('sha3-256');
      break;
    case 'keccak_256':
    case 'keccak-256':
      // @ts-ignore
      hashFn = createKeccakHash('keccak256');
      break;
    default:
      throw Error('unsupported hash function : ' + hashFunc);
  }

  values.forEach((v) => {
    // @ts-ignore
    hashFn.update(v);
  });

  return hashFn.digest();
};

export const hashValues = (values: any[], hashFunc: string) => {
  return hashBufferValues(values.map(Buffer.from), hashFunc);
};

export const signSecp = (privKey: Buffer, hash: Buffer) => {
  const sigObj = secp256k1.sign(hash, privKey);
  return sigObj.signature.toString('hex');
};

export const verifySecp = (mes: Buffer, signature: Buffer, pubKey: Buffer) => {
  return secp256k1.verify(mes, signature, pubKey);
};

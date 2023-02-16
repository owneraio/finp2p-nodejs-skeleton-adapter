import crypto from "crypto";
import * as secp256k1 from "secp256k1";
import { request } from "../../src/finp2p/requestUtils";
import { Operation, ProfileOperation } from "../../src/finp2p/assets";
import { generateNonce } from "../utils";
import { CreateDepositRequest, CreateDepositResponse, CreateOwnerProfileRequest } from "./models";


export const hashValues = (values: any[]) => {
  let hashFn = crypto.createHash("sha3-256");
  values.map(Buffer.from).forEach((v) => {
    hashFn.update(v);
  });
  return hashFn.digest();
};

export const sign = (privKey: Buffer, hash: Buffer) => {
  const sigObj = secp256k1.sign(hash, privKey);
  return sigObj.signature.toString("hex");
};

export const delay = (time: number) => new Promise((resolve) => setTimeout(resolve, time));

export const createOwnerProfile = async (req: CreateOwnerProfileRequest, host: string) => {
  return request({
    host,
    type: "post",
    url: `/finapi/profiles/owner`,
    data: req
  }).then((value: any) => {
    const val = value as ProfileOperation;
    if (val.error !== undefined || val.response === undefined) {
      throw Error("got error or missing response");
    }
    return { id: val.response.id };
  }) as { [key: string]: any };
};


export const waitOperation = async (cid: string, ttl: Date, host: string = "") => {
  let operation: Operation;
  while (true) {
    operation = await request({
      host,
      type: "get",
      url: `/finapi/operations/status/${cid}`
    }) as Operation;

    if (operation.isCompleted) {
      break;
    }

    if (new Date() >= ttl) {
      const msg = `ttl expired for waiting operation: ${cid}`;
      console.log(msg);
      throw Error(msg);
    }

    await delay(500);
  }

  return operation;
};

export const depositRequest = async (req: CreateDepositRequest, host: string) => {
  const idempotencyKey = generateNonce().toString("hex");
  const fn = () => new Promise((resolve, reject) => {
    request({
      host,
      type: "post",
      url: `/finapi/payments/deposit`,
      data: req,
      headers: {
        "Idempotency-Key": idempotencyKey
      }
    }).then(resolve)
      .catch(reject);
  });
  const deposit = await (fn() as Promise<CreateDepositResponse>);
  if (!deposit.isCompleted) {
    const op = await waitOperation(deposit.cid, new Date(Date.now() + 1000 * 360), host);
    console.log(`deposit ${op} completed`);
    if (op.isCompleted) {
      // @ts-ignore
      return op.response;
    }
  }
};
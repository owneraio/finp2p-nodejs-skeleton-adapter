import crypto from "crypto";
import * as secp256k1 from "secp256k1";
import {
  CreateDepositRequest,
  CreateDepositResponse,
  CreateOwnerProfileRequest,
  Operation,
  ProfileOperation
} from "./models";
import * as axios from "axios";

const handleErrors = (error: any) => {
  let errorMsg = "";
  if (error.response) {
    const { status, data } = error.response;
    if (status === 422) {
      errorMsg = data.errors.reduce((msg: string, err: any) => msg.concat(`${err.msg}, `), "");
    } else {
      if (data) {
        if (data.error) {
          errorMsg = data.error.message;
        } else if (data.message) {
          errorMsg = data.message;
        } else {
          errorMsg = data;
        }
      }
    }
  } else if (error.request) {
    errorMsg = error.request;
  } else {
    errorMsg = error.message;
  }

  return errorMsg;
};

export const request = async ({
                                type,
                                data,
                                headers,
                                url,
                                host
                              }: { type: string, data?: any, headers?: any, url: string, host?: string }): Promise<{ [key: string]: any }> =>
  new Promise((resolve, reject) => {
    const baseUri = `http://${host}`;
    // @ts-ignore
    axios[type](baseUri + url, data, {
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        ...headers
      }
    }).then((response: any) => {
      resolve(response.data);
    }).catch((error: any) => {
      console.log("error", error);
      const errorMsg = handleErrors(error);
      reject(errorMsg);
    });
  });


enum Secret {
  HS256 = 1,
  RS256 = 2,
}

export const generateAuthorizationHeader = (keyAndSecret: KeyAndSecret, organization: string) => {
  const apiKey = keyAndSecret.key;
  const nonce = crypto.randomBytes(16).toString("hex");
  const timestamp = Math.floor(new Date().getTime() / 1000);
  const rawToken = `${apiKey}${nonce}${timestamp}`;

  let accessToken;
  switch (keyAndSecret.secret.type) {
    case Secret.HS256:
      accessToken = crypto.createHmac("sha256", keyAndSecret.private.raw).update(rawToken).digest().toString("hex");
      break;
    case Secret.RS256:
      const signed = crypto.createSign("SHA256").update(rawToken).sign(Buffer.from(keyAndSecret.private.raw));
      accessToken = signed.toString("hex");
      break;
    default:
      console.log(`unsupported secret type: ${keyAndSecret.secret.type}`);
  }

  const authInfo = { organization, apiKey, nonce, timestamp, accessToken };
  return Buffer.from(JSON.stringify(authInfo)).toString("base64");
};

export interface KeyAndSecret {
  key: string;
  secret: {
    type: number;
    raw: string
  },
  private: {
    raw: string
  }
}

export const initAuth = (keyAndSecret: KeyAndSecret, organization: string) => {
  axios.default.interceptors.request.use((config) => {
    const headerValue = generateAuthorizationHeader(keyAndSecret, organization);
    config.headers.Authorization = `Bearer ${headerValue}`;
    return config;
  });
};

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

export const createCrypto = (): { private: Buffer, public: Buffer } => {
  // generate privKey
  let privKey;
  do {
    privKey = crypto.randomBytes(32);
  } while (!secp256k1.privateKeyVerify(privKey));

  // get the public key in a compressed format
  const pubKey = secp256k1.publicKeyCreate(privKey, true);
  return { private: privKey, public: Buffer.from(pubKey) };
};


export const generateNonce = () => {
  const buffer = Buffer.alloc(32);
  buffer.fill(crypto.randomBytes(24), 0, 24);

  const nowEpochSeconds = Math.floor(new Date().getTime() / 1000);
  const t = BigInt(nowEpochSeconds);
  buffer.writeBigInt64BE(t, 24);

  return buffer;
};

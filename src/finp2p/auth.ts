import crypto from 'crypto';
import fs from 'fs';


enum Secret {
  HS256 = 1,
  RS256 = 2,
}

let keys: any;

// Provide the api keys, secrets and private secrets (in case of asymmetric secret) associated with the organization
const getApiKeyAndSecretForOrganization = ({ organization }: { organization: string }) => {
  if (keys === undefined) {
    try {
      let env = process.env.ENV_ID || `local${process.env.ORG_FLAVOR || ''}`;
      const authFilePath = `../releases/${env}/auth.json`;
      const raw = fs.readFileSync(authFilePath);
      keys = JSON.parse(raw.toString());

    } catch (e) {
      console.log(`failed to load organization ${organization} api key and secret`);
      throw e;
    }
  }

  if (keys[organization] === undefined) {
    throw new Error(`organization: ${organization} api key and secret not found`);
  }

  return keys[organization];
};

export const generateAuthorizationHeader = ({ organization }: { organization: string })  => {
  const nonce = crypto.randomBytes(16).toString('hex');
  const timestamp = Math.floor(new Date().getTime() / 1000);
  let  keyAndSecret;
  try {
    const keysAndSecrets = getApiKeyAndSecretForOrganization({ organization });
    keyAndSecret = keysAndSecrets[0];
  } catch (e) {
    console.log('failed to generate authorization header for organization: ' + organization, e);
    return '';
  }

  const rawToken = `${keyAndSecret.key}${nonce}${timestamp}`;

  let accessToken;
  switch (keyAndSecret.secret.type) {
    case Secret.HS256:
      accessToken = crypto.createHmac('sha256', keyAndSecret.private.raw).update(rawToken).digest().toString('hex');
      break;
    case Secret.RS256:
      const signed = crypto.createSign('SHA256').update(rawToken).sign(Buffer.from(keyAndSecret.private.raw));
      accessToken = signed.toString('hex');
      break;
    default:
      console.log(`unsupported secret type: ${keyAndSecret.secret.type}`);
  }

  const authInfo = {
    organization: organization,
    apiKey: keyAndSecret.key,
    nonce,
    timestamp,
    accessToken,
  };
  return Buffer.from(JSON.stringify(authInfo)).toString('base64');
};

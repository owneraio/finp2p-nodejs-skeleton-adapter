import crypto from 'crypto';
import { FINP2PAuthKeyAndSecret as keyAndSecret } from './config';


enum Secret {
  HS256 = 1,
  RS256 = 2,
}


export const generateAuthorizationHeader = ({ organization }: { organization: string })  => {
  const nonce = crypto.randomBytes(16).toString('hex');
  const timestamp = Math.floor(new Date().getTime() / 1000);
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

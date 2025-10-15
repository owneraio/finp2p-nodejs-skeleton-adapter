import { logger } from '../lib/helpers';
import * as process from 'process';
import createApp from './app';
import { FinP2PClient } from '@owneraio/finp2p-client';
import {ConfigurationError} from "../lib/services";

const init = async () => {
  const port = process.env.PORT || '3000';

  const orgId = process.env.ORGANIZATION_ID;
  if (!orgId) {
    throw new ConfigurationError('ORGANIZATION_ID is not set');
  }
  let finP2PClient: FinP2PClient | undefined;
  const finAPIUrl = process.env.FINP2P_ADDRESS;
  const ossUrl = process.env.OSS_URL;
  if (finAPIUrl && ossUrl) {
    finP2PClient = new FinP2PClient(finAPIUrl, ossUrl);
    logger.info('FinP2PClient initialized');
  }

  const app = createApp(orgId, finP2PClient);
  app.listen(port, () => {
    logger.info(`listening at http://localhost:${port}`);
  });
};

init().then(() => {
  logger.info('Server started successfully');
}).catch((err) => {
  logger.error('Error starting server', err);
  process.exit(1);
});



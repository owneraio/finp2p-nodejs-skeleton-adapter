import { logger } from '../lib/helpers';
import * as process from 'process';
import createApp from './app';
import { FinP2PClient } from '@owneraio/finp2p-client';

const init = async () => {
  const port = process.env.PORT || '3000';

  let finP2PClient: FinP2PClient | undefined;
  const finAPIUrl = process.env.FINAPI_URL;
  const ossUrl = process.env.OSS_URL;
  if (finAPIUrl && ossUrl) {
    finP2PClient = new FinP2PClient(finAPIUrl, ossUrl);
    logger.info('FinP2PClient initialized');
  }

  const app = createApp(finP2PClient);
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



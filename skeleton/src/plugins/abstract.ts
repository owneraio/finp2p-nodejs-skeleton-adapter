import {FinP2PClient} from '@owneraio/finp2p-client';
import {LedgerCallbackService, OperationStatus, PluginError, Logger} from '@owneraio/finp2p-adapter-models';
import {operationToFinAPI} from './mappers';


export abstract class AbstractPlugin implements LedgerCallbackService {

  orgId: string;

  finP2PClient: FinP2PClient;

  logger: Logger;

  constructor(orgId: string, finP2PClient: FinP2PClient, logger: Logger) {
    this.orgId = orgId;
    this.finP2PClient = finP2PClient;
    this.logger = logger;
  }

  async sendOperationResult(cid: string, operation: OperationStatus): Promise<void> {
    const op = operationToFinAPI(operation);
    const {data, error} = await this.finP2PClient.sendCallback(cid, op);
    if (error) {
      throw new PluginError(1, `Error sending callback for CID ${cid}: ${error}`);
    }
    this.logger.info(`Callback sent for CID ${cid}: ${JSON.stringify(data)}`);
  }
}

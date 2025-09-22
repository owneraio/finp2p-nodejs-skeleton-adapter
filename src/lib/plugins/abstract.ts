import {FinP2PClient} from "@owneraio/finp2p-client";
import {LedgerCallbackService} from "./interfaces";
import {OperationStatus} from "../services";
import {operationToFinAPI} from "./mappers";
import winston from "winston";


export abstract class AbstractPlugin implements LedgerCallbackService {

  finP2PClient: FinP2PClient;
  logger: winston.Logger

  protected constructor(finP2PClient: FinP2PClient, logger: winston.Logger) {
    this.finP2PClient = finP2PClient;
    this.logger = logger;
  }

  async sendOperationResult(cid: string, operation: OperationStatus): Promise<void> {
    const op = operationToFinAPI(operation);
    const {data, error} = await this.finP2PClient.sendCallback(cid, op);
    if (error) {
      throw new Error(`Error sending callback for CID ${cid}: ${error}`);
    }
    this.logger.info(`Callback sent for CID ${cid}: ${JSON.stringify(data)}`);
  }
}

import { CommonService } from './common';
import { v4 as uuid } from 'uuid';
import { issueAssets } from '../finp2p/operational';
import { createAsset } from '../finp2p/assets';
import { FinP2PIssuerFinId, FinP2PIssuerId } from '../finp2p/config';
import { logger } from "../helpers/logger";


let service: PaymentsService;

export class PaymentsService extends CommonService {

  public static GetService(): PaymentsService {
    if (!service) {
      service = new PaymentsService();
    }
    return service;
  }

  public async deposit(request: Paths.DepositInstruction.RequestBody): Promise<Paths.DepositInstruction.Responses.$200> {
    if (request.asset.type === 'custom' && request.details !== undefined) {

      // TODO: parse request details

      logger.info('Creating asset', request.details.name);
      const asset = await createAsset(
        request.details.name,
        'collateral-basket',
        FinP2PIssuerId,
        [],
        { type: 'fiat', code: 'USD' },
        JSON.stringify({}),
      );
      logger.info('Created asset', asset.id);

      logger.info('Issuing asset', asset.id);
      await issueAssets(asset.id, 1, FinP2PIssuerFinId);

    }
    return {
      isCompleted: true,
      cid: uuid(),
      response: {
        account: request.destination,
        description: 'IBAN GB33BUKB20201555555555',
        details: request.details,
      },
    } as Paths.DepositInstruction.Responses.$200;
  }

  public async payout(request: Paths.Payout.RequestBody): Promise<Paths.Payout.Responses.$200> {
    return {
      isCompleted: true,
      cid: uuid(),
      response: {
        id: uuid(),
        source: request.source,
        destination: request.destination,
        quantity: request.quantity,
        asset: request.asset,
        timestamp: Date.now(),
        transactionDetails: {
          transactionId: uuid(),
        },
      },
    } as Paths.Payout.Responses.$200;
  }
}

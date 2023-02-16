import { CommonService } from './common';
import { v4 as uuid } from 'uuid';
import { issueAssets } from '../finp2p/operational';
import { createAsset } from '../finp2p/assets';
import { FinP2PIssuerFinId, FinP2PIssuerId } from '../finp2p/config';
import { logger } from "../helpers/logger";
import { CollateralDetails, CollateralIssuanceResult } from "./collateral";
import DepositOperationErrorInformation = Components.Schemas.DepositOperationErrorInformation;

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

      const details = request.details as CollateralDetails;
      logger.debug("Got a set of collaterals:")
      details.collaterals.forEach((collateral) => {
        logger.debug(`Collateral: ${JSON.stringify(collateral)}`)
      });
      const assetName = `Collateral Basket #${uuid()}`;

      logger.info(`Creating collateral asset ${request.details.name}`);
      const asset = await createAsset(
        assetName,
        'collateral-basket',
        FinP2PIssuerId,
        [],
        { type: 'fiat', code: 'USD' },
        JSON.stringify({}),
      );
      logger.info(`Collateral asset created: ${asset.id}`);

      logger.info(`Issuing 1 collateral asset: ${asset.id}`);
      await issueAssets(asset.id, 1, FinP2PIssuerFinId);

      logger.info(`Collateral asset issued: ${asset.id}`);

      const result = {
        assetId: asset.id,
        assetName: assetName,
        collateralValue: '0',
      } as CollateralIssuanceResult

      return {
        isCompleted: true,
        cid: uuid(),
        response: {
          account: request.destination,
          description: `Collateral ${assetName} issued`,
          details: result,
        },
      } as Paths.DepositInstruction.Responses.$200;
    }

    return {
      isCompleted: false,
      error: {  } as DepositOperationErrorInformation,
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

import { createCrypto, createOwnerProfile, depositRequest, hashValues, initAuth, sign } from "./utils/requestUtils";
import { FINP2P_HOST, ORG_MSPID, KEY_AND_SECRET } from "./configuration";
import {
  CollateralDetails,
  CollateralIssuanceResult,
  CreateDepositRequest,
  CreateOwnerProfileRequest,
  DepositAccount
} from "./utils/models";

initAuth(KEY_AND_SECRET, ORG_MSPID)

describe(`JP Morgan + WeMatch + HQLAx Repo flows`, () => {

  test(`
        Scenario: HQLAx scenario
     `, async () => {

    const lenderCrypto = createCrypto();

    const createOwnerProfileSignature = sign(
      lenderCrypto.private,
      hashValues(["createOwnerProfile", lenderCrypto.public])
    );
    const lender = await createOwnerProfile({
      publicKey: lenderCrypto.public.toString("hex"),
      signature: createOwnerProfileSignature
    } as CreateOwnerProfileRequest, FINP2P_HOST);

    const lenderFinId = lenderCrypto.public.toString("hex");
    const lenderDepositAccount = {
      asset: { type: "custom" },
      account: { type: "finId", finId: lenderFinId, orgId: ORG_MSPID }
    } as DepositAccount;

    const collateralDetails = {
      collaterals: [
        {
          isin: "FR00001311049139415000110",
          securityName: "EUR 3,75 FRANCE OAT 05-2028",
          ccy: "EUR",
          compositeRating: "AAA LT",
          quantity: "1000000.00",
          accruedInterest: "18543.38",
          priceApplied: "107.89",
          marginPercentage: "0.00",
          marginalValue: "107887.50",
          exchangeRate: "1.00",
          collateralValue: "107887.50"
        },
        {
          isin: "FR00000131044000001210000",
          securityName: "SHS VOL EDGE SPREAD B",
          ccy: "USD",
          compositeRating: "NR LT",
          quantity: "1000000.00",
          priceApplied: "1113.68",
          marginPercentage: "0.00",
          marginalValue: "1113680000.00",
          exchangeRate: "0.735294",
          collateralValue: "818882352.94"
        }
      ]
    } as CollateralDetails;
    const result = await depositRequest({
      profileId: lender.id,
      account: lenderDepositAccount,
      amount: "0",
      details: collateralDetails
    } as CreateDepositRequest, FINP2P_HOST);
    // expect(result.isCompleted).toBeTruthy();
    const collateralResult = result.depositInstruction?.depositInstruction?.details as CollateralIssuanceResult;

    console.log(`collateralResult: ${JSON.stringify(collateralResult)}`);

  });
});


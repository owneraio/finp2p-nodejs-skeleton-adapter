import {Asset, Contract, ExecutionPlan, Leg} from "../model";
import {components} from "../../../../finp2p-client/src/finapi/op-model-gen";
import {ValidationError} from "../errors";


export const assetFromAPI = (asset: components["schemas"]["asset"]): Asset => {
  switch (asset.type) {
    case "finp2p":
      return {assetType: 'finp2p', assetId: asset.resourceId}
    case "cryptocurrency":
      return {assetType: 'cryptocurrency', assetId: asset.code}
    case "fiat":
      return {assetType: 'fiat', assetId: asset.code}
  }
}

export const legFromAPI = (order: components["schemas"]["assetOrder"]): Leg => {
  const {term, instruction} = order;
  if (!term) {
    throw new ValidationError('No term in order');
  }
  if (!instruction) {
    throw new ValidationError('No instruction in order');
  }
  const leg: Leg = {
    asset: assetFromAPI(term.asset),
    amount: term.amount,
    organizationId: ''
  }

  const {sourceAccount, destinationAccount} = instruction;
  if (sourceAccount) {
    const {account} = sourceAccount;
    if (account.type === 'finId') {
      const {finId, orgId} = account;
      leg.source = {
        finId, orgId: ''
      }
    }
  }
  if (destinationAccount) {

  }


  return leg
}

export const legFromAPIOpt = (order?: components["schemas"]["assetOrder"]): Leg | undefined => {
  if (!order) {
    return undefined;
  }
  return legFromAPI(order);
}

export const executionFromAPI = (plan: components["schemas"]["executionPlan"]): ExecutionPlan => {
  const {
    id,
    intent: {intent: {type: intentType}},
    contract: {investors, contractDetails}
  } = plan;

  let contract: Contract = {}
  if (contractDetails) {
    switch (contractDetails.type) {
      case "transfer": {
        const {asset} = contractDetails;
        contract.asset = legFromAPIOpt(asset);
        break
      }
      case "issuance": {
        const {asset, settlement} = contractDetails;
        contract.asset = legFromAPIOpt(asset);
        contract.payment = legFromAPIOpt(settlement);
        break
      }
      case "buying": {
        const {asset, settlement} = contractDetails;
        contract.asset = legFromAPIOpt(asset);
        contract.payment = legFromAPIOpt(settlement);
        break
      }
      case "selling": {
        const {asset, settlement} = contractDetails;
        contract.asset = legFromAPIOpt(asset);
        contract.payment = legFromAPIOpt(settlement);
        break
      }
      case "loan": {
        const {asset, settlement} = contractDetails;
        contract.asset = legFromAPIOpt(asset);
        contract.payment = legFromAPIOpt(settlement);
        break
      }
      case "redeem": {
        const {asset, settlement} = contractDetails;
        contract.asset = legFromAPIOpt(asset);
        contract.payment = legFromAPIOpt(settlement);
        break
      }
      case "privateOffer": {
        const {asset, settlement} = contractDetails;
        contract.asset = legFromAPIOpt(asset);
        contract.payment = legFromAPIOpt(settlement);
        break
      }
      case "requestForTransfer": {
        const {asset} = contractDetails;
        contract.asset = legFromAPIOpt(asset);
        break
      }
    }
  }

  return {
    id, intentType, contract: {}
  }
}

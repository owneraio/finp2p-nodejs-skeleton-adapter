import {
  FinIdAccount,
  Asset,
  ExecutionInstruction,
  ExecutionPlan,
  ExecutionPlanOperation, IntentType,
  Leg,
  PlanContract,
  PlanInvestor,
  ValidationError,
} from '../../models';
import { OpComponents } from '@owneraio/finp2p-client';



export const assetFromFinp2pAsset = (asset: OpComponents['schemas']['finp2pAsset']): Asset => {
  return { assetType: 'finp2p', assetId: asset.id, ledgerIdentifier: asset.ledgerIdentifier };
};

const finIdAccountFromFinp2pAssetAccount = (acc: OpComponents['schemas']['finp2pAssetAccount']): FinIdAccount => {
  const { finId, orgId, custodian: { orgId: custodianOrgId } } = acc.account;
  return { finId, orgId, custodianOrgId };
};

const finIdAccountFromAPI = (account: OpComponents['schemas']['ledgerAccountAsset']): FinIdAccount => {
  return finIdAccountFromFinp2pAssetAccount(account.finp2pAccount);
};

const finIdAccountOptFromAPI = (account?: OpComponents['schemas']['ledgerAccountAsset']): FinIdAccount | undefined => {
  if (!account) return undefined;
  return finIdAccountFromAPI(account);
};

const legFromSourceDestinationExecuteAsset = (order: OpComponents['schemas']['sourceDestinationExecuteAsset']): Leg => {
  const { term, instruction } = order;
  if (!term) {
    throw new ValidationError('No term in order');
  }
  if (!instruction) {
    throw new ValidationError('No instruction in order');
  }
  const { amount } = term;
  const { sourceAccount, destinationAccount } = instruction;
  return {
    asset: assetFromFinp2pAsset(sourceAccount.asset),
    amount,
    source: finIdAccountFromFinp2pAssetAccount(sourceAccount),
    destination: finIdAccountFromFinp2pAssetAccount(destinationAccount),
  };
};

const legFromSourceDestinationExecuteAssetOpt = (order?: OpComponents['schemas']['sourceDestinationExecuteAsset']): Leg | undefined => {
  if (!order) {
    return undefined;
  }
  return legFromSourceDestinationExecuteAsset(order);
};

const legFromLoanExecuteAsset = (order: OpComponents['schemas']['loanExecuteAsset']): Leg => {
  const { assetTerm, assetInstruction } = order;
  const { amount } = assetTerm;
  const { borrowerAccount, lenderAccount } = assetInstruction;
  return {
    asset: assetFromFinp2pAsset(borrowerAccount.asset),
    amount,
    source: finIdAccountFromFinp2pAssetAccount(borrowerAccount),
    destination: finIdAccountFromFinp2pAssetAccount(lenderAccount),
  };
};

const legFromLoanExecuteAssetOpt = (order?: OpComponents['schemas']['loanExecuteAsset']): Leg | undefined => {
  if (!order) {
    return undefined;
  }
  return legFromLoanExecuteAsset(order);
};

const contractFromAPI = (contract: OpComponents['schemas']['contract']): PlanContract => {
  const { investors, contractDetails } = contract;

  const planInvestors = investors?.map(i => ({
    profileId: i.investor,
    role: i.role,
  } as PlanInvestor)) || [];

  let assetLeg: Leg | undefined;
  let paymentLeg: Leg | undefined;
  if (contractDetails) {
    switch (contractDetails.type) {
      case 'transfer': {
        const { asset } = contractDetails;
        assetLeg = legFromSourceDestinationExecuteAssetOpt(asset);
        break;
      }
      case 'issuance': {
        const { asset, settlement } = contractDetails;
        assetLeg = legFromSourceDestinationExecuteAssetOpt(asset);
        paymentLeg = legFromSourceDestinationExecuteAssetOpt(settlement);
        break;
      }
      case 'buying': {
        const { asset, settlement } = contractDetails;
        assetLeg = legFromSourceDestinationExecuteAssetOpt(asset);
        paymentLeg = legFromSourceDestinationExecuteAssetOpt(settlement);
        break;
      }
      case 'selling': {
        const { asset, settlement } = contractDetails;
        assetLeg = legFromSourceDestinationExecuteAssetOpt(asset);
        paymentLeg = legFromSourceDestinationExecuteAssetOpt(settlement);
        break;
      }
      case 'loan': {
        const { asset, settlement } = contractDetails;
        assetLeg = legFromLoanExecuteAssetOpt(asset);
        paymentLeg = legFromLoanExecuteAssetOpt(settlement);
        break;
      }
      case 'redeem': {
        const { asset, settlement } = contractDetails;
        assetLeg = legFromSourceDestinationExecuteAssetOpt(asset);
        paymentLeg = legFromSourceDestinationExecuteAssetOpt(settlement);
        break;
      }
      case 'privateOffer': {
        const { asset, settlement } = contractDetails;
        assetLeg = legFromSourceDestinationExecuteAssetOpt(asset);
        paymentLeg = legFromSourceDestinationExecuteAssetOpt(settlement);
        break;
      }
      case 'requestForTransfer': {
        const { asset } = contractDetails;
        assetLeg = legFromSourceDestinationExecuteAssetOpt(asset);
        break;
      }
    }
  }

  if (!assetLeg) {
    throw new ValidationError('No asset leg in contract');
  }

  return {
    asset: assetLeg,
    payment: paymentLeg,
    investors: planInvestors,
  };
};

type OpPlanInstruction = {
  /** Format: uint32 */
  sequence: number;
  organizations: string[];
  executionPlanOperation: OpComponents['schemas']['executionPlanOperation'];
  /** Format: int32 */
  timeout?: number;
};

const epOperationFromAPI = (instruction: OpComponents['schemas']['executionPlanOperation']): ExecutionPlanOperation => {
  switch (instruction.type) {
    case 'issue': {
      const { destination, amount } = instruction;
      return {
        type: 'issue',
        asset: assetFromFinp2pAsset(destination.finp2pAccount.asset),
        destination: finIdAccountFromAPI(destination),
        amount,
      };
    }
    case 'transfer': {
      const { source, destination, amount } = instruction;
      return {
        type: 'transfer',
        asset: assetFromFinp2pAsset(source.finp2pAccount.asset),
        destinationAsset: assetFromFinp2pAsset(destination.finp2pAccount.asset),
        source: finIdAccountFromAPI(source),
        destination: finIdAccountFromAPI(destination),
        amount,
      };
    }
    case 'redeem': {
      const { source, destination, amount } = instruction;
      return {
        type: 'redeem',
        asset: assetFromFinp2pAsset(source.finp2pAccount.asset),
        source: finIdAccountFromAPI(source),
        destination: finIdAccountFromAPI(destination),
        amount,
      };
    }
    case 'hold': {
      const { source, destination, amount } = instruction;
      return {
        type: 'hold',
        asset: assetFromFinp2pAsset(source.finp2pAccount.asset),
        source: finIdAccountFromAPI(source),
        destination: finIdAccountOptFromAPI(destination),
        amount,
      };
    }
    case 'release': {
      const { source, destination, amount } = instruction;
      return {
        type: 'release',
        asset: assetFromFinp2pAsset(source.finp2pAccount.asset),
        destinationAsset: assetFromFinp2pAsset(destination.finp2pAccount.asset),
        source: finIdAccountFromAPI(source),
        destination: finIdAccountFromAPI(destination),
        amount,
      };
    }
    case 'revertHoldInstruction': {
      const { source, destination } = instruction;
      return {
        type: 'revertHoldInstruction',
        source: finIdAccountOptFromAPI(source),
        destination: finIdAccountFromAPI(destination),
      };
    }
    case 'await': {
      const { waitUntil } = instruction;
      return {
        type: 'await',
        waitUntil,
      };
    }
  }
};


const instructionFromAPI = (instruction: OpPlanInstruction): ExecutionInstruction => {
  const { sequence, organizations, executionPlanOperation, timeout } = instruction;
  return {
    sequence,
    organizations,
    timeout,
    operation: epOperationFromAPI(executionPlanOperation),
  };
};

export const executionFromAPI = (plan: OpComponents['schemas']['executionPlan']): ExecutionPlan => {
  const {
    id,
    intent,
    contract,
    instructions,
  } = plan;

  let intentType: IntentType | undefined;
  if (intent && intent.intent) {
    intentType = intent.intent.type;
  }

  return {
    id, intentType,
    contract: contractFromAPI(contract),
    instructions: instructions?.map(instructionFromAPI) || [],
  };
};

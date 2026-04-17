import {
  LegAccount,
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

const legAccountFromFinp2pAssetAccount = (acc: OpComponents['schemas']['finp2pAssetAccount']): LegAccount => {
  const { finId, orgId, custodian: { orgId: custodianOrgId } } = acc.account;
  return { finId, orgId, custodianOrgId, asset: assetFromFinp2pAsset(acc.asset) };
};

export const legAccountFromAPI = (account: OpComponents['schemas']['ledgerAccountAsset']): LegAccount => {
  return legAccountFromFinp2pAssetAccount(account.finp2pAccount);
};

export const legAccountOptFromAPI = (account?: OpComponents['schemas']['ledgerAccountAsset']): LegAccount | undefined => {
  if (!account) return undefined;
  return legAccountFromAPI(account);
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
    source: legAccountFromFinp2pAssetAccount(sourceAccount),
    destination: legAccountFromFinp2pAssetAccount(destinationAccount),
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
    source: legAccountFromFinp2pAssetAccount(borrowerAccount),
    destination: legAccountFromFinp2pAssetAccount(lenderAccount),
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
        destination: legAccountFromAPI(destination),
        amount,
      };
    }
    case 'transfer': {
      const { source, destination, amount } = instruction;
      return {
        type: 'transfer',
        source: legAccountFromAPI(source),
        destination: legAccountFromAPI(destination),
        amount,
      };
    }
    case 'redeem': {
      const { source, destination, amount } = instruction;
      return {
        type: 'redeem',
        source: legAccountFromAPI(source),
        destination: legAccountFromAPI(destination),
        amount,
      };
    }
    case 'hold': {
      const { source, destination, amount } = instruction;
      return {
        type: 'hold',
        source: legAccountFromAPI(source),
        destination: legAccountOptFromAPI(destination),
        amount,
      };
    }
    case 'release': {
      const { source, destination, amount } = instruction;
      return {
        type: 'release',
        source: legAccountFromAPI(source),
        destination: legAccountFromAPI(destination),
        amount,
      };
    }
    case 'revertHoldInstruction': {
      const { source, destination } = instruction;
      return {
        type: 'revertHoldInstruction',
        source: legAccountOptFromAPI(source),
        destination: legAccountFromAPI(destination),
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

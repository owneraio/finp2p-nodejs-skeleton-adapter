import {
  Account,
  Asset,
  ExecutionInstruction,
  ExecutionPlan,
  ExecutionPlanOperation, IntentType,
  Leg,
  PlanContract,
  PlanInvestor,
  ValidationError,
} from '@owneraio/finp2p-adapter-models';
import { OpComponents } from '@owneraio/finp2p-client';


export const assetFromLedgerIdentifier = (ledgerAsset: OpComponents['schemas']['ledgerAssetIdentifier']): Asset => {
  return { assetType: 'finp2p', assetId: ledgerAsset.resourceId ?? ledgerAsset.tokenId };
};

export const assetFromAPI = (asset: OpComponents['schemas']['asset']): Asset => {
  return { assetType: 'finp2p', assetId: asset.resourceId };
};

export const accountFromAPI = (account: OpComponents['schemas']['components-schemas-finIdAccount']): Account => {
  return { type: 'finId', finId: account.finId };
};

export const accountOptFromAPI = (account?: OpComponents['schemas']['components-schemas-finIdAccount']): Account | undefined => {
  if (!account) {
    return undefined;
  }
  return accountFromAPI(account);
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
  const ledgerAsset = sourceAccount.finp2pAccount.asset || destinationAccount.finp2pAccount.asset;
  return {
    asset: assetFromLedgerIdentifier(ledgerAsset),
    amount,
    source: accountOptFromAPI(sourceAccount.finp2pAccount.account),
    destination: accountOptFromAPI(destinationAccount.finp2pAccount.account),
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
    asset: assetFromLedgerIdentifier(borrowerAccount.finp2pAccount.asset),
    amount,
    source: accountOptFromAPI(borrowerAccount.finp2pAccount.account),
    destination: accountOptFromAPI(lenderAccount.finp2pAccount.account),
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
        asset: assetFromLedgerIdentifier(destination.finp2pAccount.asset),
        destination: accountFromAPI(destination.finp2pAccount.account),
        amount,
      };
    }
    case 'transfer': {
      const { source, destination, amount } = instruction;
      return {
        type: 'transfer',
        asset: assetFromLedgerIdentifier(source.finp2pAccount.asset),
        source: accountFromAPI(source.finp2pAccount.account),
        destination: accountFromAPI(destination.finp2pAccount.account),
        amount,
      };
    }
    case 'redeem': {
      const { source, destination, amount } = instruction;
      return {
        type: 'redeem',
        asset: assetFromLedgerIdentifier(source.finp2pAccount.asset),
        source: accountFromAPI(source.finp2pAccount.account),
        destination: accountFromAPI(destination.finp2pAccount.account),
        amount,
      };
    }
    case 'hold': {
      const { source, destination, amount } = instruction;
      return {
        type: 'hold',
        asset: assetFromLedgerIdentifier(source.finp2pAccount.asset),
        source: accountFromAPI(source.finp2pAccount.account),
        destination: accountFromAPI(destination.finp2pAccount.account),
        amount,
      };
    }
    case 'release': {
      const { source, destination, amount } = instruction;
      return {
        type: 'release',
        asset: assetFromLedgerIdentifier(source.finp2pAccount.asset),
        source: accountFromAPI(source.finp2pAccount.account),
        destination: accountFromAPI(destination.finp2pAccount.account),
        amount,
      };
    }
    case 'revertHoldInstruction': {
      const { source, destination } = instruction;
      return {
        type: 'revertHoldInstruction',
        asset: assetFromLedgerIdentifier(destination.finp2pAccount.asset),
        source: source ? accountFromAPI(source.finp2pAccount.account) : undefined,
        destination: accountFromAPI(destination.finp2pAccount.account),
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

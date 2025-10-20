import {
  Account,
  Asset,
  ExecutionInstruction,
  ExecutionPlan,
  ExecutionPlanOperation, IntentType,
  Leg,
  PlanContract,
  PlanInvestor,
  ValidationError
} from '@owneraio/finp2p-adapter-models';
import { OpComponents } from '@owneraio/finp2p-client';


export const assetFromAPI = (asset: OpComponents['schemas']['asset']): Asset => {
  switch (asset.type) {
    case 'finp2p':
      return { assetType: 'finp2p', assetId: asset.resourceId };
    case 'cryptocurrency':
      return { assetType: 'cryptocurrency', assetId: asset.code };
    case 'fiat':
      return { assetType: 'fiat', assetId: asset.code };
  }
};

export const accountFromAPI = (account: OpComponents['schemas']['finIdAccount'] | OpComponents['schemas']['cryptoWalletAccount'] | OpComponents['schemas']['fiatAccount']): Account => {
  switch (account.type) {
    case 'finId':
      const { finId } = account;
      return { type: 'finId', finId };
    case 'cryptoWallet':
      const { address } = account;
      return { type: 'crypto', address };
    case 'fiatAccount':
      const { code } = account;
      return { type: 'iban', code };
  }
};

export const accountOptFromAPI = (account?: OpComponents['schemas']['finIdAccount'] | OpComponents['schemas']['cryptoWalletAccount'] | OpComponents['schemas']['fiatAccount'] | undefined): Account | undefined => {
  if (!account) {
    return undefined;
  }
  return accountFromAPI(account);
};

const legFromAssetOrder = (order: OpComponents['schemas']['assetOrder']): Leg => {
  const { term, instruction } = order;
  if (!term) {
    throw new ValidationError('No term in order');
  }
  if (!instruction) {
    throw new ValidationError('No instruction in order');
  }
  const { asset, amount } = term;
  const { sourceAccount, destinationAccount } = instruction;
  return {
    asset: assetFromAPI(asset),
    amount: amount,
    source: accountOptFromAPI(sourceAccount?.account),
    destination: accountOptFromAPI(destinationAccount?.account),
  };
};

const legFromAssetOrderOpt = (order?: OpComponents['schemas']['assetOrder']): Leg | undefined => {
  if (!order) {
    return undefined;
  }
  return legFromAssetOrder(order);
};

const legFromLoanOrder = (order: OpComponents['schemas']['loanOrder']): Leg => {
  const { term, instruction } = order;
  if (!term) {
    throw new ValidationError('No term in order');
  }
  if (!instruction) {
    throw new ValidationError('No instruction in order');
  }
  const { asset, amount } = term;
  const { borrowerAccount, lenderAccount } = instruction;
  return {
    asset: assetFromAPI(asset),
    amount: amount,
    source: accountOptFromAPI(borrowerAccount?.account),
    destination: accountOptFromAPI(lenderAccount?.account),
  };
};

const legFromLoanOrderOpt = (order?: OpComponents['schemas']['loanOrder']): Leg | undefined => {
  if (!order) {
    return undefined;
  }
  return legFromLoanOrder(order);
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
        assetLeg = legFromAssetOrderOpt(asset);
        break;
      }
      case 'issuance': {
        const { asset, settlement } = contractDetails;
        assetLeg = legFromAssetOrderOpt(asset);
        paymentLeg = legFromAssetOrderOpt(settlement);
        break;
      }
      case 'buying': {
        const { asset, settlement } = contractDetails;
        assetLeg = legFromAssetOrderOpt(asset);
        paymentLeg = legFromAssetOrderOpt(settlement);
        break;
      }
      case 'selling': {
        const { asset, settlement } = contractDetails;
        assetLeg = legFromAssetOrderOpt(asset);
        paymentLeg = legFromAssetOrderOpt(settlement);
        break;
      }
      case 'loan': {
        const { asset, settlement } = contractDetails;
        assetLeg = legFromLoanOrderOpt(asset);
        paymentLeg = legFromLoanOrderOpt(settlement);
        break;
      }
      case 'redeem': {
        const { asset, settlement } = contractDetails;
        assetLeg = legFromAssetOrderOpt(asset);
        paymentLeg = legFromAssetOrderOpt(settlement);
        break;
      }
      case 'privateOffer': {
        const { asset, settlement } = contractDetails;
        assetLeg = legFromAssetOrderOpt(asset);
        paymentLeg = legFromAssetOrderOpt(settlement);
        break;
      }
      case 'requestForTransfer': {
        const { asset } = contractDetails;
        assetLeg = legFromAssetOrderOpt(asset);
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
      const { asset, destination, amount, signature } = instruction;
      return {
        type: 'issue',
        asset: assetFromAPI(asset),
        destination: accountFromAPI(destination.account),
        amount,
      };
    }
    case 'transfer': {
      const { asset, source, destination, amount } = instruction;
      return {
        type: 'transfer',
        asset: assetFromAPI(asset),
        source: accountFromAPI(source.account),
        destination: accountFromAPI(destination.account),
        amount,
      };
    }
    case 'redeem': {
      const { asset, source, destination, amount } = instruction;
      return {
        type: 'redeem',
        asset: assetFromAPI(asset),
        source: accountFromAPI(source.account),
        destination: destination ? accountFromAPI(destination.account) : undefined,
        amount,
      };
    }
    case 'hold': {
      const { asset, source, destination, amount } = instruction;
      return {
        type: 'hold',
        asset: assetFromAPI(asset),
        source: accountFromAPI(source.account),
        destination: destination ? accountFromAPI(destination.account) : undefined,
        amount,
      };
    }
    case 'release': {
      const { asset, source, destination, amount } = instruction;
      return {
        type: 'release',
        asset: assetFromAPI(asset),
        source: accountFromAPI(source.account),
        destination: accountFromAPI(destination.account),
        amount,
      };
    }
    case 'revertHoldInstruction': {
      const { asset, source, destination } = instruction;
      return {
        type: 'revertHoldInstruction',
        asset: assetFromAPI(asset),
        source: source ? accountFromAPI(source.account) : undefined,
        destination: accountFromAPI(destination.account),
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

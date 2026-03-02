/**
 * Lightweight request factories for plan-based test execution.
 *
 * Unlike TestDataBuilder (which creates EIP-712 signed requests), these builders
 * use dummy signatures — plan-authorized instructions are pre-approved via plan
 * approval so real signatures are not required.
 */

import { LedgerAPI } from '@owneraio/finp2p-nodejs-skeleton-adapter';

type ExecutionContext = LedgerAPI['schemas']['executionContext'];

const DUMMY_NONCE = '00'.repeat(16);

const DUMMY_SIGNATURE: LedgerAPI['schemas']['signature'] = {
  signature: '0000',
  template: {
    type: 'hashList',
    hash: 'sha3_256',
    hashGroups: [
      {
        hash: 'sha3_256',
        fields: [{ name: 'nonce', type: 'string', value: '0000' }],
      },
    ],
  },
  hashFunc: 'sha3_256',
};

export function finp2pAsset(assetId: string): LedgerAPI['schemas']['finp2pAsset'] {
  return { type: 'finp2p', resourceId: assetId };
}

export function source(finId: string): LedgerAPI['schemas']['source'] {
  return { finId, account: { type: 'finId', finId } };
}

export function destination(finId: string): LedgerAPI['schemas']['destination'] {
  return { finId, account: { type: 'finId', finId } };
}

export function createAssetRequest(assetId: string): LedgerAPI['schemas']['CreateAssetRequest'] {
  return {
    asset: finp2pAsset(assetId),
  };
}

export function issueRequest(
  assetId: string,
  toFinId: string,
  quantity: string,
  executionContext?: ExecutionContext,
): LedgerAPI['schemas']['IssueAssetsRequest'] {
  return {
    nonce: DUMMY_NONCE,
    destination: { type: 'finId', finId: toFinId },
    quantity,
    asset: finp2pAsset(assetId),
    settlementRef: '',
    signature: DUMMY_SIGNATURE,
    executionContext,
  };
}

export function transferRequest(
  assetId: string,
  sourceFinId: string,
  destFinId: string,
  quantity: string,
  executionContext?: ExecutionContext,
): LedgerAPI['schemas']['TransferAssetRequest'] {
  return {
    nonce: DUMMY_NONCE,
    source: source(sourceFinId),
    destination: destination(destFinId),
    asset: finp2pAsset(assetId),
    quantity,
    settlementRef: '',
    signature: DUMMY_SIGNATURE,
    executionContext,
  };
}

export function holdRequest(
  assetId: string,
  sourceFinId: string,
  destFinId: string,
  quantity: string,
  operationId: string,
  executionContext?: ExecutionContext,
): LedgerAPI['schemas']['HoldOperationRequest'] {
  return {
    nonce: DUMMY_NONCE,
    source: source(sourceFinId),
    destination: destination(destFinId),
    asset: finp2pAsset(assetId),
    quantity,
    operationId,
    expiry: 0,
    signature: DUMMY_SIGNATURE,
    executionContext,
  };
}

export function releaseRequest(
  assetId: string,
  sourceFinId: string,
  destFinId: string,
  quantity: string,
  operationId: string,
  executionContext?: ExecutionContext,
): LedgerAPI['schemas']['ReleaseOperationRequest'] {
  return {
    source: source(sourceFinId),
    destination: destination(destFinId),
    asset: finp2pAsset(assetId),
    quantity,
    operationId,
    executionContext,
  };
}

export function rollbackRequest(
  assetId: string,
  sourceFinId: string,
  quantity: string,
  operationId: string,
  executionContext?: ExecutionContext,
): LedgerAPI['schemas']['RollbackOperationRequest'] {
  return {
    source: source(sourceFinId),
    asset: finp2pAsset(assetId),
    quantity,
    operationId,
    executionContext,
  };
}

export function redeemRequest(
  assetId: string,
  fromFinId: string,
  quantity: string,
  operationId?: string,
  executionContext?: ExecutionContext,
): LedgerAPI['schemas']['RedeemAssetsRequest'] {
  return {
    nonce: DUMMY_NONCE,
    operationId,
    source: { type: 'finId', finId: fromFinId },
    quantity,
    asset: finp2pAsset(assetId),
    settlementRef: '',
    signature: DUMMY_SIGNATURE,
    executionContext,
  };
}

export function planApproveRequest(planId: string): LedgerAPI['schemas']['ApproveExecutionPlanRequest'] {
  return {
    executionPlan: { id: planId },
  };
}

export function planInstructionProposalRequest(
  planId: string,
  instructionSequence: number,
): LedgerAPI['schemas']['executionPlanProposalRequest'] {
  return {
    executionPlan: {
      id: planId,
      proposal: {
        proposalType: 'instruction',
        instructionSequence,
      },
    },
  };
}

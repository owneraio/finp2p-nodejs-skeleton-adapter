/**
 * Plan executor — data-driven test generation from PlanDef.
 *
 * `planSuite(label, network, mockServerUrl, planDef)` creates a Jest `describe` block that:
 *   1. Registers + approves the plan on each organization's adapter
 *   2. Generates one `test()` per instruction, routing to the correct adapter
 *   3. For off-ledger instructions: skips adapter execution, just notifies completion
 *   4. Calls the instruction's afterHook (balance checks, plan state, etc.)
 *   5. Generates one `test()` per on-ledger fallback instruction (hold + rollback)
 */

import { LedgerAPIClient } from '../api/api';
import { TestHelpers } from '../utils/test-assertions';
import { FinP2PNetwork } from './plan-network';
import {
  transferRequest,
  issueRequest,
  holdRequest,
  releaseRequest,
  redeemRequest,
  rollbackRequest,
  planApproveRequest,
  planInstructionProposalRequest,
} from './plan-request-builders';
import { type PlanDef, registerTestPlan, completeTestPlanInstruction } from './plan-builder';

// ---------------------------------------------------------------------------
// Instruction execution
// ---------------------------------------------------------------------------

async function executeInstruction(
  client: LedgerAPIClient,
  op: Record<string, any>,
  escrowIds: Map<string, string>,
  executionContext?: { executionPlanId: string; instructionSequenceNumber: number },
): Promise<any> {
  const assetId: string = op.asset.resourceId;
  const src: string | undefined = op.source?.account?.finId;
  const dst: string | undefined = op.destination?.account?.finId;
  const amount: string = op.amount;

  switch (op.type) {
    case 'hold': {
      const opId = `escrow-${assetId}-${Date.now()}`;
      escrowIds.set(assetId, opId);
      return TestHelpers.executeAndWaitForCompletion(client, () =>
        client.escrow.hold(holdRequest(assetId, src!, dst!, amount, opId, executionContext)),
      );
    }
    case 'transfer':
      return TestHelpers.executeAndWaitForCompletion(client, () =>
        client.tokens.transfer(transferRequest(assetId, src!, dst!, amount, executionContext)),
      );
    case 'release': {
      const opId = escrowIds.get(assetId);
      if (!opId) throw new Error(`No escrow operationId found for asset ${assetId}`);
      return TestHelpers.executeAndWaitForCompletion(client, () =>
        client.escrow.release(releaseRequest(assetId, src!, dst!, amount, opId, executionContext)),
      );
    }
    case 'issue':
      return TestHelpers.executeAndWaitForCompletion(client, () =>
        client.tokens.issue(issueRequest(assetId, dst!, amount, executionContext)),
      );
    case 'redeem':
      return TestHelpers.executeAndWaitForCompletion(client, () =>
        client.tokens.redeem(redeemRequest(assetId, src!, amount, executionContext)),
      );
    case 'rollback': {
      const opId = escrowIds.get(assetId);
      if (!opId) throw new Error(`No escrow operationId found for rollback of asset ${assetId}`);
      return TestHelpers.executeAndWaitForCompletion(client, () =>
        client.escrow.rollback(rollbackRequest(assetId, src!, amount, opId, executionContext)),
      );
    }
    default:
      throw new Error(`Unknown operation type: ${op.type}`);
  }
}

// ---------------------------------------------------------------------------
// planSuite — data-driven test generation
// ---------------------------------------------------------------------------

export function planSuite(
  label: string,
  network: FinP2PNetwork,
  mockServerUrl: string | (() => string),
  planDef: PlanDef,
): void {
  const { plan, instructionDefs } = planDef;
  const normalInstructions = instructionDefs.filter((i) => !i.fallbackFor);
  const fallbackInstructions = instructionDefs.filter((i) => i.fallbackFor);

  const getMockUrl = () => (typeof mockServerUrl === 'function' ? mockServerUrl() : mockServerUrl);

  describe(label, () => {
    test('Approve plan', async () => {
      await registerTestPlan(getMockUrl(), plan);
      for (const orgId of network.organizations) {
        const client = network.getClient(orgId);
        const res = await TestHelpers.executeAndWaitForCompletion(client, () =>
          client.plan.approvePlan(planApproveRequest(plan.id)),
        );
        expect(res.isCompleted).toBe(true);
        expect(res.approval?.status).toBe('approved');
      }
    });

    const escrowIds = new Map<string, string>();

    for (const instr of normalInstructions) {
      const op = instr.operation as Record<string, any>;
      const assetId = op.asset?.resourceId ?? '?';
      const orgId = instr.organizations[0];
      const venue = instr.offLedger ? 'off-ledger' : orgId;

      // eslint-disable-next-line @typescript-eslint/no-loop-func
      test(`Instruction ${instr.sequence} [${venue}]: ${op.type} (${assetId})`, async () => {
        if (!instr.offLedger) {
          const client = network.getClient(orgId);
          const exCtx = { executionPlanId: plan.id, instructionSequenceNumber: instr.sequence };
          const res = await executeInstruction(client, op, escrowIds, exCtx);
          expect(res.isCompleted).toBe(true);
          expect(res.error).toBeUndefined();
        }

        // Notify mock server of instruction completion, then propose approval on each adapter.
        await completeTestPlanInstruction(getMockUrl(), plan.id, instr.sequence);
        for (const oid of network.organizations) {
          const orgClient = network.getClient(oid);
          const proposalRes = await TestHelpers.executeAndWaitForCompletion(orgClient, () =>
            orgClient.plan.proposal(planInstructionProposalRequest(plan.id, instr.sequence)),
          );
          expect(proposalRes.isCompleted).toBe(true);
          expect(proposalRes.approval?.status).toBe('approved');
        }

        await instr.afterHook?.(plan.id, instr.sequence);
      });
    }

    // Fallback instructions: hold (correlated instruction) → rollback.
    // Off-ledger fallbacks are skipped.
    for (const fb of fallbackInstructions) {
      const correlated = instructionDefs.find((i) => i.sequence === fb.fallbackFor);
      if (!correlated) throw new Error(`Fallback ${fb.sequence} references missing instruction ${fb.fallbackFor}`);

      if (correlated.offLedger) continue;

      const fbOp = fb.operation as Record<string, any>;
      const assetId = fbOp.asset?.resourceId ?? '?';
      const orgId = fb.organizations[0];

      // eslint-disable-next-line @typescript-eslint/no-loop-func
      test(`Fallback ${fb.sequence} [${orgId}]: ${fbOp.type} for instruction ${fb.fallbackFor} (${assetId})`, async () => {
        const fbEscrowIds = new Map<string, string>();

        // Execute the correlated instruction (hold) to set up escrow
        const correlatedOp = correlated.operation as Record<string, any>;
        const correlatedClient = network.getClient(correlated.organizations[0]);
        const holdRes = await executeInstruction(correlatedClient, correlatedOp, fbEscrowIds);
        expect(holdRes.isCompleted).toBe(true);

        // Execute the fallback (rollback)
        const fbClient = network.getClient(orgId);
        const fbRes = await executeInstruction(fbClient, fbOp, fbEscrowIds);
        expect(fbRes.isCompleted).toBe(true);
        expect(fbRes.error).toBeUndefined();

        await fb.afterHook?.(plan.id, fb.sequence);
      });
    }
  });
}

/**
 * PlanBuilder — fluent builder for FinP2P execution plans with per-instruction hooks.
 *
 * Each test defines instructions explicitly (no intent-to-instruction translation):
 *
 *   PlanBuilder.plan(planId)
 *     .terms({ asset: {...}, settlement: {...} })
 *     .instruction(1, [orgId], holdOp(...), afterHook)
 *     .instruction(2, [orgId], transferOp(...), afterHook)
 *     .instruction(3, [orgId], releaseOp(...), afterHook)
 *     .fallback(4, [orgId], rollbackOp(...), 1, afterHook)
 *     .build()
 */

import * as crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// Wire-format types (matching DLT adapter API execution plan shape)
// ---------------------------------------------------------------------------

interface ApiAsset {
  type: 'finp2p';
  resourceId: string;
}

interface ApiAccountWrapper {
  account: { type: 'finId'; finId: string };
}

interface ApiLeg {
  term: { asset: ApiAsset; amount: string };
  instruction: {
    sourceAccount?: ApiAccountWrapper;
    destinationAccount?: ApiAccountWrapper;
  };
}

export interface ApiInstruction {
  sequence: number;
  organizations: string[];
  executionPlanOperation: Record<string, unknown>;
}

export interface ApiPlan {
  id: string;
  intent: undefined;
  contract: {
    investors: unknown[];
    contractDetails: {
      asset?: ApiLeg;
      settlement?: ApiLeg;
    };
  };
  instructions: ApiInstruction[];
}

// ---------------------------------------------------------------------------
// Hook + instruction definition types
// ---------------------------------------------------------------------------

export type AfterInstructionHook = (planId: string, sequence: number) => Promise<void>;

export interface InstructionDef {
  sequence: number;
  organizations: string[];
  operation: Record<string, unknown>;
  afterHook?: AfterInstructionHook;
  fallbackFor?: number;
  /** When true, this instruction executes on another blockchain (not the adapter under test). */
  offLedger?: boolean;
}

export interface PlanDef {
  plan: ApiPlan;
  instructionDefs: InstructionDef[];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function asset(resourceId: string): ApiAsset {
  return { type: 'finp2p', resourceId };
}

function account(finId: string): ApiAccountWrapper {
  return { account: { type: 'finId', finId } };
}

function leg(assetId: string, amount: string, source?: string, destination?: string): ApiLeg {
  return {
    term: { asset: asset(assetId), amount },
    instruction: {
      sourceAccount: source ? account(source) : undefined,
      destinationAccount: destination ? account(destination) : undefined,
    },
  };
}

// ---------------------------------------------------------------------------
// Exported operation helpers (used by tests to build instructions)
// ---------------------------------------------------------------------------

export function transferOp(assetId: string, source: string, destination: string, amount: string) {
  return { type: 'transfer', asset: asset(assetId), source: account(source), destination: account(destination), amount };
}

export function holdOp(assetId: string, source: string, destination: string, amount: string) {
  return { type: 'hold', asset: asset(assetId), source: account(source), destination: account(destination), amount };
}

export function releaseOp(assetId: string, source: string, destination: string, amount: string) {
  return { type: 'release', asset: asset(assetId), source: account(source), destination: account(destination), amount };
}

export function issueOp(assetId: string, destination: string, amount: string) {
  return { type: 'issue', asset: asset(assetId), destination: account(destination), amount };
}

export function redeemOp(assetId: string, source: string, amount: string) {
  return { type: 'redeem', asset: asset(assetId), source: account(source), amount };
}

export function rollbackOp(assetId: string, source: string, amount: string) {
  return { type: 'rollback', asset: asset(assetId), source: account(source), amount };
}

// ---------------------------------------------------------------------------
// PlanBuilder — fluent builder
// ---------------------------------------------------------------------------

class PlanDefinitionBuilder {
  private contractDetails: { asset?: ApiLeg; settlement?: ApiLeg } = {};

  private instructionDefs: InstructionDef[] = [];

  constructor(private planId: string = crypto.randomUUID()) {}

  terms(details: {
    asset?: { assetId: string; amount: string; source?: string; destination?: string };
    settlement?: { assetId: string; amount: string; source?: string; destination?: string };
  }): this {
    this.contractDetails = {
      asset: details.asset
        ? leg(details.asset.assetId, details.asset.amount, details.asset.source, details.asset.destination)
        : undefined,
      settlement: details.settlement
        ? leg(details.settlement.assetId, details.settlement.amount, details.settlement.source, details.settlement.destination)
        : undefined,
    };
    return this;
  }

  instruction(
    sequence: number,
    organizations: string[],
    operation: Record<string, unknown>,
    afterHookOrOpts?: AfterInstructionHook | { offLedger?: boolean },
    afterHook?: AfterInstructionHook,
  ): this {
    const isOpts = afterHookOrOpts && typeof afterHookOrOpts !== 'function';
    const opts = isOpts ? afterHookOrOpts : {};
    const hook = isOpts ? afterHook : afterHookOrOpts;
    this.instructionDefs.push({
      sequence, organizations, operation, afterHook: hook, offLedger: opts.offLedger,
    });
    return this;
  }

  fallback(
    sequence: number,
    organizations: string[],
    operation: Record<string, unknown>,
    fallbackFor: number,
    afterHookOrOpts?: AfterInstructionHook | { offLedger?: boolean },
    afterHook?: AfterInstructionHook,
  ): this {
    const isOpts = afterHookOrOpts && typeof afterHookOrOpts !== 'function';
    const opts = isOpts ? afterHookOrOpts : {};
    const hook = isOpts ? afterHook : afterHookOrOpts;
    this.instructionDefs.push({
      sequence, organizations, operation, afterHook: hook, fallbackFor, offLedger: opts.offLedger,
    });
    return this;
  }

  build(): PlanDef {
    const normalInstructions = this.instructionDefs.filter((i) => !i.fallbackFor);
    return {
      plan: {
        id: this.planId,
        intent: undefined,
        contract: {
          investors: [],
          contractDetails: this.contractDetails,
        },
        instructions: normalInstructions.map((i) => ({
          sequence: i.sequence,
          organizations: i.organizations,
          executionPlanOperation: i.operation,
        })),
      },
      instructionDefs: this.instructionDefs,
    };
  }
}

export class PlanBuilder {
  static plan(planId?: string): PlanDefinitionBuilder {
    return new PlanDefinitionBuilder(planId);
  }
}

// ---------------------------------------------------------------------------
// Per-test plan registration (HTTP bridge to MockFinP2PServer)
// ---------------------------------------------------------------------------

export async function registerTestPlan(mockServerUrl: string, plan: ApiPlan): Promise<void> {
  const res = await fetch(`${mockServerUrl}/plans`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(plan),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to register test plan ${plan.id}: ${text}`);
  }
}

export async function completeTestPlanInstruction(mockServerUrl: string, planId: string, sequence: number): Promise<void> {
  const res = await fetch(`${mockServerUrl}/plans/${encodeURIComponent(planId)}/complete/${sequence}`, {
    method: 'POST',
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to complete instruction ${sequence} for plan ${planId}: ${text}`);
  }
}

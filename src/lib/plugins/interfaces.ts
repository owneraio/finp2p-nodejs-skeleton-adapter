// TODO: that is an PoC interface for plan approval


import {
  Asset,
  DepositOperation,
  DestinationAccount,
  FinIdAccount,
  OperationStatus, PlanApprovalStatus, ReceiptOperation,
} from "../services";


export interface PlanApprovalPlugin {
  validateIssuance(destination: FinIdAccount, asset: Asset, amount: string): Promise<PlanApprovalStatus>;

  validateTransfer(source: FinIdAccount, destination: DestinationAccount, asset: Asset, amount: string): Promise<PlanApprovalStatus>;

  validateRedemption(source: FinIdAccount, destination: DestinationAccount | undefined, asset: Asset, amount: string): Promise<PlanApprovalStatus>;
}

export interface AsyncPlanApprovalPlugin {

  validateIssuance(idempotencyKey: string, cid: string, destination: FinIdAccount, asset: Asset, amount: string): Promise<void>;

  validateTransfer(idempotencyKey: string, cid: string, source: FinIdAccount, destination: DestinationAccount, asset: Asset, amount: string): Promise<void>;

  validateRedemption(idempotencyKey: string, cid: string, source: FinIdAccount, destination: DestinationAccount | undefined, asset: Asset, amount: string): Promise<void>;
}

//------------------------------------------------------------


export interface PaymentsPlugin {

  deposit(idempotencyKey: string, cid: string, ownerFinId: string, asset: Asset, amount: string): Promise<DepositOperation>;

  depositCustom(idempotencyKey: string, cid: string, ownerFinId: string, amount: string, details: any): Promise<DepositOperation>;

  withdraw(idempotencyKey: string, cid: string, source: FinIdAccount, destination: DestinationAccount, asset: Asset, amount: string): Promise<ReceiptOperation>;
}


export interface AsyncPaymentsPlugin {

  deposit(idempotencyKey: string, cid: string, ownerFinId: string, asset: Asset, amount: string): Promise<void>;

  depositCustom(idempotencyKey: string, cid: string, ownerFinId: string, amount: string, details: any): Promise<void>;

  withdraw(idempotencyKey: string, cid: string, source: FinIdAccount, destination: DestinationAccount, asset: Asset, amount: string): Promise<void>;
}

//------------------------------------------------------------

export interface LedgerCallbackService {
  sendOperationResult(cid: string, operation: OperationStatus): Promise<void>
}


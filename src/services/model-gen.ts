declare namespace Components {
  namespace Schemas {
    export type Asset = CryptocurrencyAsset | FiatAsset | Finp2pAsset;
    export interface Balance {
      asset: Asset;
      /**
             * the number of asset tokens
             */
      balance: string;
    }
    export interface CryptoWalletAccount {
      type: 'cryptoWallet';
      /**
             * address of the cryptocurrency wallet
             */
      address: string;
    }
    export interface CryptocurrencyAsset {
      type: 'cryptocurrency';
      /**
             * unique identifier symbol of the cryptocurrency
             */
      code: string;
    }
    export interface CustomAsset {
      type: 'custom';
    }
    export type DepositAsset = CryptocurrencyAsset | FiatAsset | Finp2pAsset | CustomAsset;
    export interface DepositInstruction {
      account: /* describes destination for remote operations operations */ Destination;
      /**
             * Instructions for the deposit operation
             */
      description: string;
      /**
             * Any addition deposit specific information
             */
      details?: {
        [key: string]: any;
      };
      /**
             * operation id
             */
      operationId?: string;
    }
    export interface DepositOperation {
      /**
             * unique correlation id which identify the operation
             */
      cid: string;
      /**
             * flag indicating if the operation completed, if true then error or response must be present (but not both)
             */
      isCompleted: boolean;
      error?: DepositOperationErrorInformation;
      response?: DepositInstruction;
    }
    export interface DepositOperationErrorInformation {
    }
    /**
         * describes destination for remote operations operations
         */
    export interface Destination {
      /**
             * FinID, public key of the user
             */
      finId: string;
      account: FinIdAccount | CryptoWalletAccount | FiatAccount;
    }
    export interface EmptyOperation {
      /**
             * unique correlation id which identify the operation
             */
      cid: string;
      /**
             * flag indicating if the operation completed, if true then error or response must be present (but not both)
             */
      isCompleted: boolean;
      error?: EmptyOperationErrorInformation;
    }
    export interface EmptyOperationErrorInformation {
    }
    export interface ExecutionContext {
      /**
             * execution plan id
             */
      executionPlanId: string;
      /**
             * execution instruction sequence number
             */
      instructionSequenceNumber: number; // uint32
    }
    export interface ExecutionOperationErrorInformation {
    }
    export interface ExecutionPlanApprovalOperation {
      /**
             * unique correlation id which identify the operation
             */
      cid: string;
      /**
             * flag indicating if the operation completed, if true then error or response must be present (but not both)
             */
      isCompleted: boolean;
      approval: PlanApproved | PlanRejected;
    }
    export interface FiatAccount {
      type: 'fiatAccount';
      /**
             * IBAN or other code to represent a fiat account
             */
      code: string;
    }
    export interface FiatAsset {
      type: 'fiat';
      /**
             * unique identifier code of the fiat currency - based on ISO-4217
             */
      code: string;
    }
    /**
         * describing a field in the hash group
         */
    export interface Field {
      /**
             * name of field
             */
      name: string;
      /**
             * type of field
             */
      type: 'string' | 'int' | 'bytes';
      /**
             * hex representation of the field value
             */
      value: string;
    }
    export interface FinIdAccount {
      type: 'finId';
      /**
             * FinID, public key of the user
             */
      finId: string;
    }
    export interface Finp2pAsset {
      type: 'finp2p';
      /**
             * Unique resource ID of the FinP2P asset [format]('https://finp2p.atlassian.net/wiki/spaces/FINP2P/pages/67764240/FinP2P+Network+Interface+Specification#ResourceID-format')
             *
             */
      resourceId: string;
    }
    export interface HashGroup {
      /**
             * hex representation of the hash group hash value
             */
      hash: string;
      /**
             * list of fields by order they appear in the hash group
             */
      fields: /* describing a field in the hash group */ Field[];
    }
    /**
         * 32 bytes buffer (24 randomly generated bytes by the client + 8 bytes epoch timestamp seconds) encoded to hex:
         *
         *   const nonce = Buffer.alloc(32);
         *   nonce.fill(crypto.randomBytes(24), 0, 24);
         *
         *   const nowEpochSeconds = Math.floor(new Date().getTime() / 1000);
         *   const t = BigInt(nowEpochSeconds);
         *   nonce.writeBigInt64BE(t, 24);
         *
         */
    export type Nonce = string;
    export interface OperationBase {
      /**
             * unique correlation id which identify the operation
             */
      cid: string;
      /**
             * flag indicating if the operation completed, if true then error or response must be present (but not both)
             */
      isCompleted: boolean;
    }
    export interface OperationStatus {
      type: 'receipt' | 'deposit' | 'empty' | 'approval';
      operation: DepositOperation | ReceiptOperation | EmptyOperation | ExecutionPlanApprovalOperation;
    }
    export type PayoutAsset = CryptocurrencyAsset | FiatAsset;
    export interface PayoutInstruction {
      /**
             * withdrawal description
             */
      description: string;
    }
    export interface PlanApproved {
      status: 'approved';
    }
    export interface PlanRejected {
      status: 'rejected';
      failure?: ValidationFailure | RegulationFailure;
    }
    export interface Receipt {
      /**
             * the receipt id
             */
      id: string;
      asset: Asset;
      /**
             * How many units of the asset tokens
             */
      quantity: string;
      /**
             * transaction timestamp
             */
      timestamp: number; // int64
      source?: Source;
      destination?: /* describes destination for remote operations operations */ Destination;
      transactionDetails?: /* Additional input and output details for UTXO supporting DLTs */ TransactionDetails;
    }
    export interface ReceiptOperation {
      /**
             * unique correlation id which identify the operation
             */
      cid: string;
      /**
             * flag indicating if the operation completed, if true then error or response must be present (but not both)
             */
      isCompleted: boolean;
      error?: ReceiptOperationErrorInformation;
      response?: Receipt;
    }
    export interface ReceiptOperationErrorInformation {
      /**
             * 1 for failure in regApps validation, 4 failure in signature verification
             */
      code: number; // uint32
      message: string;
      regulationErrorDetails?: RegulationError[];
    }
    export interface RegulationError {
      /**
             * the type of regulation
             */
      regulationType: string;
      /**
             * actionable details of the error
             */
      details: string;
    }
    export interface RegulationFailure {
      failureType: 'regulationFailure';
      errors: RegulationError[];
    }
    /**
         * represent a signature template information
         */
    export interface Signature {
      /**
             * hex representation of the signature
             */
      signature: string;
      template: /* ordered list of hash groups */ SignatureTemplate;
    }
    /**
         * ordered list of hash groups
         */
    export interface SignatureTemplate {
      hashGroups: HashGroup[];
      /**
             * hex representation of the combined hash groups hash value
             */
      hash: string;
    }
    export interface Source {
      /**
             * FinID, public key of the user
             */
      finId: string;
      account: FinIdAccount;
    }
    /**
         * Additional input and output details for UTXO supporting DLTs
         */
    export interface TransactionDetails {
      /**
             * The Transaction id on the underlying ledger
             */
      transactionId: string;
      /**
             * The Operation id
             */
      operationId?: string;
    }
    export interface ValidationFailure {
      failureType: 'validationFailure';
      /**
             * ledger error code for validation
             */
      code: number; // uint32
      message: string;
    }
  }
}
declare namespace Paths {
  namespace ApproveExecutionPlan {
    export interface RequestBody {
      /**
             * execution plan information
             */
      executionPlan: {
        /**
                 * execution plan id
                 */
        id: string;
      };
    }
    namespace Responses {
      export type $200 = Components.Schemas.ExecutionPlanApprovalOperation;
    }
  }
  namespace CreateAsset {
    export interface HeaderParameters {
      'Idempotency-Key': Parameters.IdempotencyKey;
    }
    namespace Parameters {
      export type IdempotencyKey = string;
    }
    export interface RequestBody {
      asset: Components.Schemas.Asset;
    }
    namespace Responses {
      export type $200 = Components.Schemas.EmptyOperation;
    }
  }
  namespace DepositInstruction {
    export interface HeaderParameters {
      'Idempotency-Key': Parameters.IdempotencyKey;
    }
    namespace Parameters {
      export type IdempotencyKey = string;
    }
    export interface RequestBody {
      destination: /* describes destination for remote operations operations */ Components.Schemas.Destination;
      owner: Components.Schemas.Source;
      asset: Components.Schemas.DepositAsset;
      /**
             * Amount to deposit
             */
      amount?: string;
      details?: {
        [key: string]: any;
      };
      nonce?: /**
             * 32 bytes buffer (24 randomly generated bytes by the client + 8 bytes epoch timestamp seconds) encoded to hex:
             *
             *   const nonce = Buffer.alloc(32);
             *   nonce.fill(crypto.randomBytes(24), 0, 24);
             *
             *   const nowEpochSeconds = Math.floor(new Date().getTime() / 1000);
             *   const t = BigInt(nowEpochSeconds);
             *   nonce.writeBigInt64BE(t, 24);
             *
             */
      Components.Schemas.Nonce;
      signature?: /* represent a signature template information */ Components.Schemas.Signature;
    }
    namespace Responses {
      export type $200 = Components.Schemas.DepositOperation;
    }
  }
  namespace GetAssetBalance {
    export interface RequestBody {
      owner: Components.Schemas.Source;
      asset: Components.Schemas.Asset;
    }
    namespace Responses {
      export type $200 = Components.Schemas.Balance;
    }
  }
  namespace GetOperation {
    namespace Parameters {
      export type Cid = string;
    }
    export interface PathParameters {
      cid: Parameters.Cid;
    }
    namespace Responses {
      export type $200 = Components.Schemas.OperationStatus;
    }
  }
  namespace GetReceipt {
    namespace Parameters {
      export type TransactionId = string;
    }
    export interface PathParameters {
      transactionId: Parameters.TransactionId;
    }
    namespace Responses {
      export type $200 = Components.Schemas.ReceiptOperation;
    }
  }
  namespace HoldOperation {
    export interface HeaderParameters {
      'Idempotency-Key': Parameters.IdempotencyKey;
    }
    namespace Parameters {
      export type IdempotencyKey = string;
    }
    export interface RequestBody {
      nonce: /**
             * 32 bytes buffer (24 randomly generated bytes by the client + 8 bytes epoch timestamp seconds) encoded to hex:
             *
             *   const nonce = Buffer.alloc(32);
             *   nonce.fill(crypto.randomBytes(24), 0, 24);
             *
             *   const nowEpochSeconds = Math.floor(new Date().getTime() / 1000);
             *   const t = BigInt(nowEpochSeconds);
             *   nonce.writeBigInt64BE(t, 24);
             *
             */
      Components.Schemas.Nonce;
      /**
             * Escrow operation id
             */
      operationId: string;
      source: Components.Schemas.Source;
      destination?: /* describes destination for remote operations operations */ Components.Schemas.Destination;
      /**
             * How many units of the asset tokens
             */
      quantity: string;
      asset: Components.Schemas.Asset;
      /**
             * ttl expiry value indicating the escrow hold time limitation
             */
      expiry: number; // uint64
      signature: /* represent a signature template information */ Components.Schemas.Signature;
      executionContext?: Components.Schemas.ExecutionContext;
    }
    namespace Responses {
      export type $200 = Components.Schemas.ReceiptOperation;
    }
  }
  namespace IssueAssets {
    export interface HeaderParameters {
      'Idempotency-Key': Parameters.IdempotencyKey;
    }
    namespace Parameters {
      export type IdempotencyKey = string;
    }
    export interface RequestBody {
      nonce: /**
             * 32 bytes buffer (24 randomly generated bytes by the client + 8 bytes epoch timestamp seconds) encoded to hex:
             *
             *   const nonce = Buffer.alloc(32);
             *   nonce.fill(crypto.randomBytes(24), 0, 24);
             *
             *   const nowEpochSeconds = Math.floor(new Date().getTime() / 1000);
             *   const t = BigInt(nowEpochSeconds);
             *   nonce.writeBigInt64BE(t, 24);
             *
             */
      Components.Schemas.Nonce;
      destination: Components.Schemas.FinIdAccount;
      /**
             * How many units of the asset tokens
             */
      quantity: string;
      asset: Components.Schemas.Finp2pAsset;
      /**
             * Reference to the corresponding settlement operation
             */
      settlementRef: string;
      signature: /* represent a signature template information */ Components.Schemas.Signature;
      executionContext?: Components.Schemas.ExecutionContext;
    }
    namespace Responses {
      export type $200 = Components.Schemas.ReceiptOperation;
    }
  }
  namespace Payout {
    export interface HeaderParameters {
      'Idempotency-Key': Parameters.IdempotencyKey;
    }
    namespace Parameters {
      export type IdempotencyKey = string;
    }
    export interface RequestBody {
      source: Components.Schemas.Source;
      destination: /* describes destination for remote operations operations */ Components.Schemas.Destination;
      /**
             * How many units of the asset
             */
      quantity: string;
      payoutInstruction?: Components.Schemas.PayoutInstruction;
      asset: Components.Schemas.PayoutAsset;
      nonce?: /**
             * 32 bytes buffer (24 randomly generated bytes by the client + 8 bytes epoch timestamp seconds) encoded to hex:
             *
             *   const nonce = Buffer.alloc(32);
             *   nonce.fill(crypto.randomBytes(24), 0, 24);
             *
             *   const nowEpochSeconds = Math.floor(new Date().getTime() / 1000);
             *   const t = BigInt(nowEpochSeconds);
             *   nonce.writeBigInt64BE(t, 24);
             *
             */
      Components.Schemas.Nonce;
      signature?: /* represent a signature template information */ Components.Schemas.Signature;
    }
    namespace Responses {
      export type $200 = Components.Schemas.ReceiptOperation;
    }
  }
  namespace RedeemAssets {
    export interface HeaderParameters {
      'Idempotency-Key': Parameters.IdempotencyKey;
    }
    namespace Parameters {
      export type IdempotencyKey = string;
    }
    export interface RequestBody {
      nonce: /**
             * 32 bytes buffer (24 randomly generated bytes by the client + 8 bytes epoch timestamp seconds) encoded to hex:
             *
             *   const nonce = Buffer.alloc(32);
             *   nonce.fill(crypto.randomBytes(24), 0, 24);
             *
             *   const nowEpochSeconds = Math.floor(new Date().getTime() / 1000);
             *   const t = BigInt(nowEpochSeconds);
             *   nonce.writeBigInt64BE(t, 24);
             *
             */
      Components.Schemas.Nonce;
      source: Components.Schemas.FinIdAccount;
      /**
             * How many units of the asset tokens
             */
      quantity: string;
      asset: Components.Schemas.Finp2pAsset;
      /**
             * Reference to the corresponding payment operation
             */
      settlementRef: string;
      signature: /* represent a signature template information */ Components.Schemas.Signature;
      executionContext?: Components.Schemas.ExecutionContext;
    }
    namespace Responses {
      export type $200 = Components.Schemas.ReceiptOperation;
    }
  }
  namespace ReleaseOperation {
    export interface HeaderParameters {
      'Idempotency-Key': Parameters.IdempotencyKey;
    }
    namespace Parameters {
      export type IdempotencyKey = string;
    }
    export interface RequestBody {
      /**
             * Hold operation id
             */
      operationId: string;
      source: Components.Schemas.Source;
      destination: /* describes destination for remote operations operations */ Components.Schemas.Destination;
      /**
             * How many units of the asset tokens
             */
      quantity: string;
      asset: Components.Schemas.Asset;
      executionContext?: Components.Schemas.ExecutionContext;
    }
    namespace Responses {
      export type $200 = Components.Schemas.ReceiptOperation;
    }
  }
  namespace RollbackOperation {
    export interface HeaderParameters {
      'Idempotency-Key': Parameters.IdempotencyKey;
    }
    namespace Parameters {
      export type IdempotencyKey = string;
    }
    export interface RequestBody {
      /**
             * Hold operation id
             */
      operationId: string;
      source: Components.Schemas.Source;
      /**
             * How many units of the asset tokens
             */
      quantity: string;
      asset: Components.Schemas.Asset;
      executionContext?: Components.Schemas.ExecutionContext;
    }
    namespace Responses {
      export type $200 = Components.Schemas.ReceiptOperation;
    }
  }
  namespace TransferAsset {
    export interface HeaderParameters {
      'Idempotency-Key': Parameters.IdempotencyKey;
    }
    namespace Parameters {
      export type IdempotencyKey = string;
    }
    export interface RequestBody {
      nonce: /**
             * 32 bytes buffer (24 randomly generated bytes by the client + 8 bytes epoch timestamp seconds) encoded to hex:
             *
             *   const nonce = Buffer.alloc(32);
             *   nonce.fill(crypto.randomBytes(24), 0, 24);
             *
             *   const nowEpochSeconds = Math.floor(new Date().getTime() / 1000);
             *   const t = BigInt(nowEpochSeconds);
             *   nonce.writeBigInt64BE(t, 24);
             *
             */
      Components.Schemas.Nonce;
      source: Components.Schemas.Source;
      destination: /* describes destination for remote operations operations */ Components.Schemas.Destination;
      /**
             * How many units of the asset tokens
             */
      quantity: string;
      asset: Components.Schemas.Asset;
      /**
             * Reference to the corresponding payment operation
             */
      settlementRef: string;
      signature: /* represent a signature template information */ Components.Schemas.Signature;
      executionContext?: Components.Schemas.ExecutionContext;
    }
    namespace Responses {
      export type $200 = Components.Schemas.ReceiptOperation;
    }
  }
}

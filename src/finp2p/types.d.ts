declare namespace OpComponents {
  namespace OpSchemas {
    export type Asset = CryptocurrencyAsset | FiatAsset | Finp2pAsset;
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
    /**
         * describes destination for remote operations operations
         */
    export interface Destination {
      /**
             * FinID, public key of the user
             */
      finId: string;
      account: FinIdAccount | EscrowAccount | CryptoWalletAccount | FiatAccount;
    }
    export interface EscrowAccount {
      type: 'escrow';
      /**
             * escrow account id
             */
      escrowAccountId: string;
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
    export interface FinIdAccount {
      type: 'finId';
      finId: string;
    }
    export interface Finp2pAsset {
      type: 'finp2p';
      /**
             * unique resource ID of the FinP2P asset
             */
      resourceId: string;
    }
    export interface Input {
      /**
             * transaction id of the input token
             */
      transactionId: string;
      /**
             * token input quantity
             */
      quantity: string;
      /**
             * index of the token in the transaction that created it
             */
      index: number;
    }
    export interface Output {
      /**
             * token output quantity
             */
      quantity: string;
      /**
             * toke destination hex representation of a secp256k1 public key 33 bytes compressed
             */
      publicKey: string;
      /**
             * index of the token in the transaction
             */
      index: number;
    }
    export interface Source {
      /**
             * FinID, public key of the user
             */
      finId: string;
      account: FinIdAccount | EscrowAccount;
    }
    export interface Transaction {
      /**
             * the receipt id
             */
      id: string;
      asset: Asset;
      /**
             * quantity of the assets
             */
      quantity: string;
      /**
             * transaction timestamp
             */
      timestamp: number; // int64
      source?: Source;
      destination?: /* describes destination for remote operations operations */ Destination;
      /**
             * the id of related / counterpary operation
             */
      settlementRef?: string;
      transactionDetails?: /* Additional input and output details for UTXO supporting DLTs */ TransactionDetails;
    }
    /**
         * Additional input and output details for UTXO supporting DLTs
         */
    export interface TransactionDetails {
      /**
             * Transaction id
             */
      transactionId: string;
      inputs: Input[];
      outputs: Output[];
    }
  }
}
declare namespace Paths {
  namespace ImportTransactions {
    export interface RequestBody {
      transactions: OpComponents.OpSchemas.Transaction[];
    }
    namespace Responses {
      export interface $200 {
      }
    }
  }
}

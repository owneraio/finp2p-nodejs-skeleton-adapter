# FinP2P Adapter Nodejs

This is a sample project of FinP2P adapter on Nodejs.
The goal is to show integration with FinP2P router, show the translation of FinP2P instructions into ledger operations and the ability to use this in the future as a skeleton for actual implementation.

The project is built around generated models and handlers from the original OpenAPI document describing the FinP2P ledger operations: `dlt-adapter-api.yaml`.

The project simulates the operation of a ledger by storing the state of accounts in memory, 
in the case of real integration, the part of the code in `src/services` should be replaced by interaction with a real ledger or tokenization platform.


### Install dependencies

`npm install`

### Build the project

`npm run build`

### Run tests

`npm test`

### Run the node

`npm run start`

### Re-generate models and handlers

`npm run api-generate`


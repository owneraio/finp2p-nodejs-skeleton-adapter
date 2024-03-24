# FinP2P Ledger Adapter Nodejs

This is a sample project of a FinP2P ledger adapter on Nodejs.
The goal is to show how to integrate with a FinP2P router, translating FinP2P instructions into ledger operations and providing a foundational framework for implementations.

The project is built around generated models and handlers derived from the FinP2P ledger operations as detailed in the "dlt-adapter-api.yaml" OpenAPI document.

In its current form, the project emulates ledger functionality by maintaining account states within memory. For genuine deployments, the sections within src/services need to be adapted for actual ledger interactions or integration with a tokenization platform.

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


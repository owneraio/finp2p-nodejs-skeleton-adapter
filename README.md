© 2024 XCap Ecosystem Ltd trading as Ownera®. All rights reserved. SPDX-License-Identifier: Apache-2.0

This is a sample project of FinP2P adapter on Nodejs.
The goal is to show integration with FinP2P router, show the translation of FinP2P instructions into ledger operations and the ability to use this in the future as a skeleton for actual implementation.

This is a sample project of a FinP2P ledger adapter on Nodejs.
The goal is to show how to integrate with a FinP2P router, translating FinP2P instructions into ledger operations and providing a foundational framework for implementations.

The project simulates the operation of a ledger by storing the state of accounts in memory, 
in the case of real integration, the part of the code in `src/services` should be replaced by interaction with a real ledger or tokenization platform.

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


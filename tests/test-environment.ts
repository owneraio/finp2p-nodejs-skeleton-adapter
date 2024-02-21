import NodeEnvironment from "jest-environment-node";
import { GenericContainer, StartedTestContainer } from "testcontainers";
import { EnvironmentContext, JestEnvironmentConfig } from "@jest/environment";
import { ethers } from "ethers";
import Finp2pERC20 from "../artifacts/contracts/token/ERC20/utils/Finp2pERC20.sol/Finp2pERC20.json";
import { FinP2PContract } from "../src/contracts/finp2p";
import createApp from "../src/app";
import * as http from "http";
import * as console from "console";
import { GanacheLogExtractor } from "./ganache";

class CustomTestEnvironment extends NodeEnvironment {

  ganacheContainer: StartedTestContainer | undefined;
  httpServer: http.Server | undefined;

  constructor(config: JestEnvironmentConfig, context: EnvironmentContext) {
    super(config, context);
  }

  async setup() {
    try {
      const logExtractor = new GanacheLogExtractor();
      this.ganacheContainer = await new GenericContainer("trufflesuite/ganache-cli:v6.12.1")
        .withLogConsumer((stream) => logExtractor.consume(stream))
        .withExposedPorts(8545)
        .start();

      await logExtractor.started();
      const privateKeys = logExtractor.privateKeys;
      if (privateKeys.length === 0) {
        console.log("No private keys found");
        return;
      }
      const operator = privateKeys[0];
      console.log("Ganache container started successfully.");
      const rpcHost = this.ganacheContainer.getHost();
      const rpcPort = this.ganacheContainer.getMappedPort(8545).toString();
      const rpcUrl = `http://${rpcHost}:${rpcPort}`;
      const contractAddress = await this.deployFinP2PContract(rpcUrl, operator);

      const finP2PContract = new FinP2PContract(rpcUrl, operator, contractAddress);

      const port = 3001;
      const app = createApp(finP2PContract);
      console.log("App created successfully.");

      this.httpServer = app.listen(port, () => {
        console.log(`Server listening on port ${port}`);
      });

      this.global.appPort = port;

    } catch (err) {
      console.error("Error starting Ganache container:", err);
    }
  }

  async teardown() {
    try {
      this.httpServer?.close();
      await this.ganacheContainer?.stop();
      console.log("Ganache container stopped successfully.");
    } catch (err) {
      console.error("Error stopping Ganache container:", err);
    }
  }

  async deployFinP2PContract(rpcURL: string, privateKey: string) {
    console.log("Deploying FinP2P contract...");
    const provider = new ethers.providers.JsonRpcProvider(rpcURL);
    const wallet = new ethers.Wallet(privateKey, provider);
    const factory = new ethers.ContractFactory(Finp2pERC20.abi, Finp2pERC20.bytecode, wallet);
    const contract = await factory.deploy();
    const address = contract.address;
    console.log("FinP2P contract deployed successfully at:", address);

    return address;
  }

}

module.exports = CustomTestEnvironment;
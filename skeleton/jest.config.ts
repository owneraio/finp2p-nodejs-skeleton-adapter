import type { Config } from "jest";

const config: Config = {
  preset: "ts-jest",
  testTimeout: 120000,
  testEnvironment: "<rootDir>/tests/test-environment.ts",
  roots: ["<rootDir>/src", "<rootDir>/tests"],
  testMatch: ["<rootDir>/tests/**/*.test.+(ts|tsx|js)"],
  transform: {
    "^.+\\.(ts|tsx)$": "ts-jest",
  },
  moduleNameMapper: {
    "\\.graphql$": "<rootDir>/tests/support/graphql-stub.js",
  },
};

export default config;

module.exports = {
  preset: "ts-jest",
  testEnvironment: "./tests/test-environment.ts",
  testEnvironmentOptions: {
    orgId: "bank-id",
    hashFunction: "sha3-256",
    // adapter: {
    //   url: "http://localhost:3000",
    // },
  },
  testTimeout: 120000,
  "roots": [
    "<rootDir>/src",
    "<rootDir>/adapter-tests"
  ],
  "testMatch": [
    "<rootDir>/adapter-tests/**/*.test.+(ts|tsx|js)"
  ],
  "transform": {
    "^.+\\.(ts|tsx)$": "ts-jest"
  }
};

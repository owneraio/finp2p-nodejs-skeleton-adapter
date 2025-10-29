module.exports = {
  preset: "ts-jest",
  testEnvironmentOptions: {
    orgId: "bank-id",
    hashFunction: "sha3-256",
    serverAddress: "http://localhost:3000/api",
  },
  testTimeout: 120000,
  "roots": [
    "<rootDir>/tests"
  ],
  "testMatch": [
    "<rootDir>/tests/**/*.test.+(ts|tsx|js)"
  ],
  "transform": {
    "^.+\\.(ts|tsx)$": "ts-jest"
  }
};

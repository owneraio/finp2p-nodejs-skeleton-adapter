module.exports = {
  preset: "ts-jest",
  testEnvironment: "./tests/test-environment.ts",
  testEnvironmentOptions: {
  },
  testTimeout: 120000,
  "roots": [
    "<rootDir>/src",
    "<rootDir>/tests"
  ],
  "testMatch": [
    "<rootDir>/tests/**/*.test.+(ts|tsx|js)"
  ],
  "transform": {
    "^.+\\.(ts|tsx)$": "ts-jest"
  }
};

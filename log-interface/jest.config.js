/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: ['<rootDir>/tests/**/*.test.ts'],
};

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
  testPathIgnorePatterns: [
    'tests/e2e.test.ts', 
    'tests/server.integration.test.ts',
    'tests/openai-client-compatibility.e2e.test.ts',
    'tests/client-integrations/*.e2e.test.ts'
  ],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: [
    'text',
    'lcov',
    'html',
  ],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  testTimeout: 10000,
  // CI environment optimizations
  maxWorkers: process.env.CI ? 1 : '50%',
  forceExit: process.env.CI ? true : false,
  detectOpenHandles: process.env.CI ? false : true,
};
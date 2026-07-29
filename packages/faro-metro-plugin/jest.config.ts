import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  testMatch: ['**/test/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'mjs', 'json'],
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: {
        module: 'ESNext',
        moduleResolution: 'bundler',
        esModuleInterop: true,
        sourceMap: true,
      },
      useESM: true,
    }],
  },
};

export default config;

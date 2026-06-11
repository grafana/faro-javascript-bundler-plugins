import { defineConfig } from 'jest';

const config = defineConfig({
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/test/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@grafana/faro-bundlers-shared$': '<rootDir>/../faro-bundlers-shared/src/index.ts',
    '^@grafana/faro-cli$': '<rootDir>/../faro-cli/src/index.ts',
    '^@grafana/faro-esbuild-plugin$': '<rootDir>/../faro-esbuild/src/index.ts',
    '^@grafana/faro-metro-plugin$': '<rootDir>/../faro-metro-plugin/src/index.ts',
    '^@grafana/faro-rollup-plugin$': '<rootDir>/../faro-rollup/src/index.ts',
    '^@grafana/faro-webpack-plugin$': '<rootDir>/../faro-webpack/src/index.ts',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      // Keep Jest transpilation CommonJS while package source/build remains ESM.
      tsconfig: {
        module: 'CommonJS',
        moduleResolution: 'node',
        esModuleInterop: true,
        sourceMap: true,
      },
    }],
  },
});

export default config;

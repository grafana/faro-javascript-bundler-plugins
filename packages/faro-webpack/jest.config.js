import { defineConfig } from 'jest';

const config = defineConfig({
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/test/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'mjs', 'json'],
  // msw@2 pulls ESM-only deps (e.g. rettime); transpile them for Jest.
  transformIgnorePatterns: [
    '/node_modules/(?!(msw|@mswjs|@open-draft|rettime|until-async|strict-event-emitter|@bundled-es-modules)/)',
  ],
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
      tsconfig: 'tsconfig.json',
    }],
    '^.+\\.(js|mjs)$': ['babel-jest', {
      presets: [
        ['@babel/preset-env', { targets: { node: 'current' } }],
      ],
    }],
  },
});

export default config;

/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/test/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      // module=Node18 allows `import.meta` in source (used by metroDeps.ts for ESM-safe
      // createRequire); ts-jest still emits CJS-compatible output via the useESM=false default.
      tsconfig: {
        module: 'CommonJS',
        moduleResolution: 'node',
        esModuleInterop: true,
        sourceMap: true,
      },
    }],
  },
};

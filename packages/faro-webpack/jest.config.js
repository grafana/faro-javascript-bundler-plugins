/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/test/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'mjs', 'json'],
  // msw@2 pulls ESM-only deps (e.g. rettime); transpile them for Jest.
  transformIgnorePatterns: [
    '/node_modules/(?!(msw|@mswjs|@open-draft|rettime|until-async|strict-event-emitter|@bundled-es-modules)/)',
  ],
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
};

import { defineConfig } from 'tsdown';

export default defineConfig([
  {
    format: 'cjs',
    outDir: 'dist/cjs',
    target: 'esnext',
    sourcemap: true,
    clean: ['dist'],
  },
  {
    format: 'esm',
    outDir: 'dist/esm',
    target: 'esnext',
    sourcemap: true,
    publint: true,
    attw: {
      level: 'error',
      profile: 'node16',
    },
  },
  {
    entry: {
      cli: 'src/cli.ts',
    },
    format: 'cjs',
    outDir: 'dist/cjs',
    target: 'esnext',
    sourcemap: true,
    clean: false,
    banner: {
      js: '#!/usr/bin/env node',
    },
  },
]);

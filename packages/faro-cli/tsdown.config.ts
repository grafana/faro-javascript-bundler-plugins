import { defineConfig } from 'tsdown';

export default defineConfig([
  {
    format: 'cjs',
    outDir: 'dist/cjs',
    target: 'esnext',
    sourcemap: true,
    clean: ['dist'],
    outExtensions: () => ({
      dts: '.d.ts',
    }),
  },
  {
    format: 'esm',
    outDir: 'dist/esm',
    target: 'esnext',
    sourcemap: true,
    dts: false,
  },
  {
    entry: {
      cli: 'src/cli.ts',
    },
    format: 'cjs',
    outDir: 'dist/cjs',
    target: 'esnext',
    sourcemap: true,
    dts: false,
    clean: false,
    banner: {
      js: '#!/usr/bin/env node',
    },
  },
]);

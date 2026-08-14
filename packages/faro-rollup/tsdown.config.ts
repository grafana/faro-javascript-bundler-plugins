import { defineConfig } from 'tsdown';

export default defineConfig([
  {
    format: 'cjs',
    outDir: 'dist/cjs',
    target: 'esnext',
    sourcemap: true,
    clean: ['dist'],
    deps: {
      dts: {
        neverBundle: true,
      },
    },
  },
  {
    format: 'esm',
    outDir: 'dist/esm',
    target: 'esnext',
    sourcemap: true,
    deps: {
      dts: {
        neverBundle: true,
      },
    },
    publint: true,
    attw: {
      level: 'error',
      profile: 'node16',
    },
  },
]);

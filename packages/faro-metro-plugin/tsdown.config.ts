import { defineConfig } from 'tsdown';

export default defineConfig([
  {
    format: 'cjs',
    outDir: 'dist/cjs',
    target: 'esnext',
    sourcemap: true,
    clean: ['dist'],
    outputOptions: {
      exports: 'named',
    },
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
]);

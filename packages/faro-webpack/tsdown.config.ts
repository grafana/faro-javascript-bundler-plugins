import { defineConfig } from 'tsdown';

export default defineConfig([
  {
    entry: {
      index: 'src/index.cjs.ts',
    },
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
]);

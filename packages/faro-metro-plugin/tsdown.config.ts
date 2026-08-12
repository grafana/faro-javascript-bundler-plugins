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
]);

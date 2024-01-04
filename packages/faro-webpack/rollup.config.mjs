import typescript from '@rollup/plugin-typescript';
import packageJson from "./package.json" assert { type: "json" };

export default {
  input: 'src/index.ts',
  output: [
    {
      file: packageJson.module,
      format: "esm",
      exports: "named",
      sourcemap: true,
    },
    {
      file: packageJson.main,
      format: "cjs",
      exports: "named",
      sourcemap: true,
    },
  ],
  plugins: [typescript()],
  external: ['webpack'],
};

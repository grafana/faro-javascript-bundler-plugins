import resolve from "@rollup/plugin-node-resolve";
import babel from "@rollup/plugin-babel";
import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import typescript from "@rollup/plugin-typescript";
import packageJson from "./package.json" assert { type: "json" };

const extensions = [".ts"];

export default {
  input: "src/index.ts",
  external: [
    ...Object.keys(packageJson.dependencies),
    "webpack",
    "cross-fetch"
  ],
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
  plugins: [
    typescript({
      outDir: "dist",
    }),
    babel({
      extensions,
      babelHelpers: "bundled",
      include: ["src/**/*"],
      exclude: [/node_modules/, /test/]
    }),
    json(),
    resolve({
      extensions,
      rootDir: "./src",
      preferBuiltins: true,
    }),
    commonjs({
      include: /node_modules/
    }),
  ],
};

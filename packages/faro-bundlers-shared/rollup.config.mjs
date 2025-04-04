import resolve from "@rollup/plugin-node-resolve";
import babel from "@rollup/plugin-babel";
import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import typescript from "@rollup/plugin-typescript";
import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const configPath = join(
  dirname(fileURLToPath(import.meta.url)),
  './package.json'
);
const packageJson = JSON.parse(fs.readFileSync(configPath, 'utf8'));

const extensions = [".ts"];

export default {
  input: "src/index.ts",
  external: [
    ...Object.keys(packageJson.dependencies),
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
      exclude: ["**/*.test.ts", "**/test/**"]
    }),
    babel({
      extensions,
      babelHelpers: "bundled",
      include: ["src/**/*", "**/*.test.ts", "**/test/**"],
      exclude: /node_modules/
    }),
    json(),
    resolve({
      extensions,
      rootDir: "./src",
      preferBuiltins: true,
    }),
    commonjs({
      include: /node_modules/,
      exclude: ["**/*.test.ts", "**/test/**"]
    }),
  ],
};

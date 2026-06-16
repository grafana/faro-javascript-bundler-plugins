import resolve from "@rollup/plugin-node-resolve";
import babel from "@rollup/plugin-babel";
import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import typescript from "@rollup/plugin-typescript";
import packageJson from './package.json' with { type: 'json' };

const extensions = [".ts"];

export default {
  input: "src/index.ts",
  external: [
    ...Object.keys(packageJson.dependencies),
  ],
  output: [
    {
      file: packageJson.main,
      format: "esm",
      exports: "named",
      sourcemap: true,
    }
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

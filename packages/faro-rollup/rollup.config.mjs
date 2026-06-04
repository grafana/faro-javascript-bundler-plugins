import babel from "@rollup/plugin-babel";
import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import resolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";
import packageJson from './package.json' with { type: 'json' };

const extensions = [".ts"];

// @rollup/plugin-typescript v12 requires emitted declaration files to live
// within the bundle's output directory, so declarations can only be generated
// alongside a single-directory output. Emit them with the CJS build (which the
// "types" field points at) and disable declarations for the ESM build.
const plugins = ({ declaration }) => [
  typescript(
    declaration
      ? { declarationDir: "dist/cjs", exclude: ["**/*.test.ts", "**/test/**"] }
      : { declaration: false, exclude: ["**/*.test.ts", "**/test/**"] }
  ),
  babel({
    extensions,
    babelHelpers: "bundled",
    include: ["src/**/*"],
    exclude: [/node_modules/, /test/, "*.test.ts"]
  }),
  json(),
  resolve({
    extensions,
    rootDir: "./src",
    preferBuiltins: true,
  }),
  commonjs({
    include: /node_modules/,
    exclude: ["**/*.test.ts", "**/test/**"],
  }),
];

const external = [
  ...Object.keys(packageJson.dependencies),
];

export default [
  {
    input: "src/index.ts",
    external,
    output: {
      file: packageJson.main,
      format: "cjs",
      exports: "named",
      sourcemap: true,
    },
    plugins: plugins({ declaration: true }),
  },
  {
    input: "src/index.ts",
    external,
    output: {
      file: packageJson.module,
      format: "esm",
      exports: "named",
      sourcemap: true,
    },
    plugins: plugins({ declaration: false }),
  },
];

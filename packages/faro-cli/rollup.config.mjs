import resolve from "@rollup/plugin-node-resolve";
import babel from "@rollup/plugin-babel";
import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import typescript from '@rollup/plugin-typescript';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf8'));
const extensions = [".ts"];

const external = [
  ...Object.keys(pkg.dependencies || {}),
  ...Object.keys(pkg.peerDependencies || {}),
  'fs',
  'path',
  'child_process',
  'os',
];

// @rollup/plugin-typescript v12 requires emitted declaration files to live
// within the bundle's output directory, so declarations can only be generated
// alongside a single-directory output. Emit them with the CJS build (which the
// "types" field points at) and disable declarations for the ESM build.
// src/cli.ts imports ../package.json (outside src), which would pull the
// inferred rootDir up to the package root and nest declarations under src/.
// It is bundled separately below, so exclude it from the library program.
const libExclude = ["**/*.test.ts", "**/test/**", "src/cli.ts"];

const libPlugins = ({ declaration }) => [
  typescript(
    declaration
      ? { declarationDir: "dist/cjs", exclude: libExclude }
      : { declaration: false, exclude: libExclude }
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
    exclude: ["**/*.test.ts", "**/test/**"]
  }),
];

export default [
  {
    input: 'src/index.ts',
    output: {
      file: pkg.main,
      format: 'cjs',
      sourcemap: true,
    },
    plugins: libPlugins({ declaration: true }),
    external,
  },
  {
    input: 'src/index.ts',
    output: {
      file: pkg.module,
      format: 'esm',
      sourcemap: true,
    },
    plugins: libPlugins({ declaration: false }),
    external,
  },
  {
    input: 'src/cli.ts',
    output: {
      file: 'dist/cjs/cli.js',
      format: 'cjs',
      sourcemap: true,
      banner: '#!/usr/bin/env node',
    },
    plugins: [
      // Executable entry point — no published types, so skip declarations.
      typescript({
        declaration: false,
        exclude: ["**/*.test.ts"],
      }),
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
        exclude: "*.test.ts"
      }),
    ],
    external,
  },
];

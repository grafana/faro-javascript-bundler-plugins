import resolve from "@rollup/plugin-node-resolve";
import babel from "@rollup/plugin-babel";
import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import typescript from '@rollup/plugin-typescript';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf8'));
const extensions = [".ts"];

export default [
  {
    input: 'src/index.ts',
    output: [
      {
        file: pkg.main,
        format: 'cjs',
        sourcemap: true,
      },
      {
        file: pkg.module,
        format: 'esm',
        sourcemap: true,
      },
    ],
    plugins: [
      typescript({
        outDir: "dist",
        exclude: ["**/*.test.ts", "**/test/**"],
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
        exclude: ["**/*.test.ts", "**/test/**"]
      }),
    ],
    external: [
      ...Object.keys(pkg.dependencies || {}),
      ...Object.keys(pkg.peerDependencies || {}),
      'fs',
      'path',
      'child_process',
      'os',
    ],
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
      typescript({
        outDir: "dist",
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
    external: [
      ...Object.keys(pkg.dependencies || {}),
      ...Object.keys(pkg.peerDependencies || {}),
      'fs',
      'path',
      'child_process',
      'os',
    ],
  },
];
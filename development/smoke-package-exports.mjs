import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const packages = [
  {
    name: '@grafana/faro-bundlers-shared',
    dir: 'packages/faro-bundlers-shared',
    requireShape: (module) => assert.equal(typeof module.ESBUILD_PLUGIN_NAME, 'string'),
    importShape: (module) => assert.equal(typeof module.ESBUILD_PLUGIN_NAME, 'string'),
  },
  {
    name: '@grafana/faro-cli',
    dir: 'packages/faro-cli',
    requireShape: (module) => assert.equal(typeof module.uploadSourceMaps, 'function'),
    importShape: (module) => assert.equal(typeof module.uploadSourceMaps, 'function'),
  },
  {
    name: '@grafana/faro-esbuild-plugin',
    dir: 'packages/faro-esbuild',
    requireShape: (module) => assert.equal(typeof module, 'function'),
    importShape: (module) => assert.equal(typeof module.default, 'function'),
  },
  {
    name: '@grafana/faro-metro-plugin',
    dir: 'packages/faro-metro-plugin',
    requireShape: (module) => assert.equal(typeof module.default, 'function'),
    importShape: (module) => assert.equal(typeof module.default, 'function'),
  },
  {
    name: '@grafana/faro-rollup-plugin',
    dir: 'packages/faro-rollup',
    requireShape: (module) => assert.equal(typeof module, 'function'),
    importShape: (module) => assert.equal(typeof module.default, 'function'),
  },
  {
    name: '@grafana/faro-webpack-plugin',
    dir: 'packages/faro-webpack',
    requireShape: (module) => assert.equal(typeof module, 'function'),
    importShape: (module) => assert.equal(typeof module.default, 'function'),
  },
];

const assertFileExists = (filePath) => {
  assert.ok(existsSync(filePath), `Expected file to exist: ${path.relative(repoRoot, filePath)}`);
};

const assertFileMissing = (filePath) => {
  assert.ok(!existsSync(filePath), `Expected file to be absent: ${path.relative(repoRoot, filePath)}`);
};

for (const pkg of packages) {
  const packageRoot = path.join(repoRoot, pkg.dir);
  const packageJsonPath = path.join(packageRoot, 'package.json');
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
  const rootExport = packageJson.exports['.'];

  assert.equal(packageJson.types, 'dist/cjs/index.d.cts', `${pkg.name} top-level types should point at CJS declarations`);
  assert.equal(rootExport.import.types, './dist/esm/index.d.mts', `${pkg.name} import types should point at ESM declarations`);
  assert.equal(rootExport.import.default, './dist/esm/index.mjs', `${pkg.name} import default should point at ESM output`);
  assert.equal(rootExport.require.types, './dist/cjs/index.d.cts', `${pkg.name} require types should point at CJS declarations`);
  assert.equal(rootExport.require.default, './dist/cjs/index.cjs', `${pkg.name} require default should point at CJS output`);

  assertFileExists(path.join(packageRoot, 'dist/esm/index.d.mts'));
  assertFileExists(path.join(packageRoot, 'dist/cjs/index.d.cts'));
  assertFileMissing(path.join(packageRoot, 'dist/esm/index.d.ts'));
  assertFileMissing(path.join(packageRoot, 'dist/cjs/index.d.ts'));

  pkg.requireShape(require(pkg.name));
  pkg.importShape(await import(pkg.name));
}

const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'faro-package-exports-'));

try {
  await symlink(path.join(repoRoot, 'node_modules'), path.join(tempRoot, 'node_modules'), 'junction');

  await writeFile(
    path.join(tempRoot, 'package.json'),
    JSON.stringify({ private: true, type: 'module' }, null, 2)
  );

  await writeFile(
    path.join(tempRoot, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          target: 'ESNext',
          noEmit: true,
          strict: true,
          skipLibCheck: false,
          types: ['node'],
        },
        files: ['import-consumer.mts', 'require-consumer.cts'],
      },
      null,
      2
    )
  );

  await writeFile(
    path.join(tempRoot, 'import-consumer.mts'),
    [
      "import * as shared from '@grafana/faro-bundlers-shared';",
      "import * as cli from '@grafana/faro-cli';",
      "import faroEsbuildPlugin from '@grafana/faro-esbuild-plugin';",
      "import type { WebpackFaroSourceMapUploaderPluginOptions } from '@grafana/faro-webpack-plugin';",
      "import withFaroConfig from '@grafana/faro-metro-plugin';",
      "import faroUploader from '@grafana/faro-rollup-plugin';",
      "import FaroSourceMapUploaderPlugin from '@grafana/faro-webpack-plugin';",
      '',
      'const values: unknown[] = [',
      '  shared.ESBUILD_PLUGIN_NAME,',
      '  cli.uploadSourceMaps,',
      '  faroEsbuildPlugin,',
      '  withFaroConfig,',
      '  faroUploader,',
      '  FaroSourceMapUploaderPlugin,',
      '];',
      'const webpackOptions: Partial<WebpackFaroSourceMapUploaderPluginOptions> = {};',
      'values.push(webpackOptions);',
      '',
      'export { values };',
      '',
    ].join('\n')
  );

  await writeFile(
    path.join(tempRoot, 'require-consumer.cts'),
    [
      "import shared = require('@grafana/faro-bundlers-shared');",
      "import cli = require('@grafana/faro-cli');",
      "import faroEsbuildPlugin = require('@grafana/faro-esbuild-plugin');",
      "import metro = require('@grafana/faro-metro-plugin');",
      "import faroUploader = require('@grafana/faro-rollup-plugin');",
      "import type { WebpackFaroSourceMapUploaderPluginOptions } from '@grafana/faro-webpack-plugin';",
      "import FaroSourceMapUploaderPlugin = require('@grafana/faro-webpack-plugin');",
      '',
      'const values: unknown[] = [',
      '  shared.ESBUILD_PLUGIN_NAME,',
      '  cli.uploadSourceMaps,',
      '  faroEsbuildPlugin,',
      '  metro.default,',
      '  faroUploader,',
      '  FaroSourceMapUploaderPlugin,',
      '];',
      'const webpackOptions: Partial<WebpackFaroSourceMapUploaderPluginOptions> = {};',
      'values.push(webpackOptions);',
      '',
      'export = values;',
      '',
    ].join('\n')
  );

  const tscBin = path.join(repoRoot, 'node_modules/typescript/bin/tsc');
  const result = spawnSync(process.execPath, [tscBin, '--project', 'tsconfig.json'], {
    cwd: tempRoot,
    encoding: 'utf8',
  });

  assert.equal(
    result.status,
    0,
    ['TypeScript package export smoke test failed.', result.stdout, result.stderr].filter(Boolean).join('\n')
  );
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

console.log('Package export smoke test passed.');

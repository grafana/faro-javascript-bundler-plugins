import test from 'ava';
import { rollup } from 'rollup';
import faroUploader from '@grafana/faro-rollup-plugin';
import path from 'path';
import fs from 'fs';

// Helper to create a run rollup with custom config
const runRollup = async (customConfig = {}, outputConfig = {}) => {
  const bundle = await rollup({
    input: path.resolve(process.cwd(), 'src/test/main.js'),
    plugins: [
      faroUploader({
        appName: 'rollup-test-app',
        endpoint: 'http://localhost:8000/faro/api/v1',
        appId: '1',
        ...customConfig,
      })
    ]
  });

  // Set default output options if not provided
  const output = {
    file: path.resolve(process.cwd(), 'dist/bundle.js'),
    format: 'cjs',
    ...outputConfig
  };

  return bundle.write(output);
};

test('basic bundleId injection test', async t => {
  const output = await runRollup({ bundleId: 'test' });

  t.truthy(output.output[0].code.startsWith(`(function(){try{var g=typeof window!=="undefined"?window:typeof global!=="undefined"?global:typeof self!=="undefined"?self:{};g["__faroBundleId_rollup-test-app"]="test"`));
});

test('custom bundleId is correctly injected', async t => {
  const output = await runRollup({ bundleId: 'custom-test-id' });

  // Verify the bundle contains our custom bundleId
  t.truthy(output.output[0].code.includes(`g["__faroBundleId_rollup-test-app"]="custom-test-id"`));
});

test('bundleId is generated if not provided', async t => {
  const output = await runRollup({});

  // Extract the generated bundleId with a regex
  const bundleIdMatch = output.output[0].code.match(/g\["__faroBundleId_rollup-test-app"\]="([^"]+)"/);

  // Verify we got a match and the bundleId is a string
  t.truthy(bundleIdMatch);
  t.is(typeof bundleIdMatch[1], 'string');
  t.true(bundleIdMatch[1].length > 0);
});

test('skipUpload option sets environment variable with bundleId', async t => {
  await runRollup({
    bundleId: 'env-test-id',
    skipUpload: true
  });

  // Verify the environment variable was set
  t.is(process.env['FARO_BUNDLE_ID_ROLLUP_TEST_APP'], 'env-test-id');
});

test('bundleId is prepended to the code', async t => {
  const output = await runRollup({ bundleId: 'test' });

  // Create a simple regex to check code starts with the bundle ID snippet
  const bundleIdRegex = /^\(function\(\)\{try\{var g=typeof window!=="undefined"\?window:typeof global!=="undefined"\?global:typeof self!=="undefined"\?self:\{\};g\["__faroBundleId_rollup-test-app"\]="test"\}catch\(l\)\{\}\}\)\(\);/;

  t.regex(output.output[0].code, bundleIdRegex);
});
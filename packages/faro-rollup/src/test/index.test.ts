import { ModuleFormat, rollup } from 'rollup';
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
        apiKey: 'test-api-key',
        stackId: 'test-stack-id',
        appId: '1',
        ...customConfig,
      })
    ]
  });

  // Set default output options if not provided
  const output = {
    file: path.resolve(process.cwd(), 'dist/bundle.js'),
    format: 'commonjs' as ModuleFormat,
    ...outputConfig
  };

  return bundle.write(output);
};

describe('Faro Rollup Plugin', () => {
  test('basic bundleId injection test', async () => {
    const output = await runRollup({ bundleId: 'test' });

    expect(output.output[0].code.startsWith(`(function(){try{var g=typeof window!=="undefined"?window:typeof global!=="undefined"?global:typeof self!=="undefined"?self:{};g["__faroBundleId_rollup-test-app"]="test"`)).toBeTruthy();
  });

  test('custom bundleId is correctly injected', async () => {
    const output = await runRollup({ bundleId: 'custom-test-id' });

    // Verify the bundle contains our custom bundleId
    expect(output.output[0].code).toContain(`g["__faroBundleId_rollup-test-app"]="custom-test-id"`);
  });

  test('bundleId is generated if not provided', async () => {
    const output = await runRollup({});

    // Extract the generated bundleId with a regex
    const bundleIdMatch = output.output[0].code.match(/g\["__faroBundleId_rollup-test-app"\]="([^"]+)"/);

    // Verify we got a match and the bundleId is a string
    expect(bundleIdMatch).toBeTruthy();
    expect(typeof bundleIdMatch?.[1]).toBe('string');
    expect(bundleIdMatch?.[1]?.length).toBeGreaterThan(0);
  });

  test('skipUpload option sets environment variable with bundleId', async () => {
    await runRollup({
      bundleId: 'env-test-id',
      skipUpload: true
    });

    // Verify the environment variable was set
    expect(fs.readFileSync(path.resolve(process.cwd(), '.env.ROLLUP_TEST_APP'), 'utf8')).toContain('FARO_BUNDLE_ID_ROLLUP_TEST_APP=env-test-id');
  });

  test('bundleId is prepended to the code', async () => {
    const output = await runRollup({ bundleId: 'test' });

    // Create a simple regex to check code starts with the bundle ID snippet
    const bundleIdRegex = /^\(function\(\)\{try\{var g=typeof window!=="undefined"\?window:typeof global!=="undefined"\?global:typeof self!=="undefined"\?self:\{\};g\["__faroBundleId_rollup-test-app"\]="test"\}catch\(l\)\{\}\}\)\(\);/;

    expect(output.output[0].code).toMatch(bundleIdRegex);
  });
});
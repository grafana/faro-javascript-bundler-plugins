import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import webpack, { Configuration, Stats } from 'webpack';
import FaroSourceMapUploaderPlugin from '@grafana/faro-webpack-plugin';

// Helper function to run webpack with custom configuration
const runWebpack = async (customConfig = {}, filename = 'bundle.js') => {
  const webpackConfig: Configuration = {
    entry: {
      module: path.resolve(process.cwd(), 'src/test/main.cjs')
    },
    output: {
      filename: filename,
      path: path.resolve(process.cwd(), 'src/test/dist'),
    },
    mode: 'production',
    plugins: [
      new FaroSourceMapUploaderPlugin({
        appName: 'webpack-test-app',
        endpoint: 'http://localhost:8000/faro/api/v1',
        apiKey: 'test-api-key',
        stackId: 'test-stack-id',
        appId: '1',
        ...customConfig
      }),
    ]
  };

  return new Promise<Stats | undefined>((resolve, reject) => {
    webpack(webpackConfig, (err, stats) => {
      if (err || stats?.hasErrors()) {
        reject(err || stats?.compilation.errors);
      } else {
        resolve(stats);
      }
    });
  });
};

// Store original env to restore after tests
let originalEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  // Save the original environment variables
  originalEnv = { ...process.env };
});

afterEach(() => {
  // Restore original environment variables
  process.env = originalEnv;
});

describe('Faro Webpack Plugin', () => {
  // Test the default bundleId injection
  test('basic bundleId injection test', async () => {
    await runWebpack({ bundleId: 'test'}, 'bundleInjection.js');
    const content = fs.readFileSync(`${process.cwd()}/src/test/dist/bundleInjection.js`, 'utf8');
    const bundleIdMatch = content.match(/__faroBundleId_webpack-test-app"\]="([^"]+)"/);

    expect(bundleIdMatch?.[0]).toBe(`__faroBundleId_webpack-test-app"]="test"`);
  });

  // Test that a bundleId is generated if not provided
  test('bundleId is generated if not provided', async () => {
    await runWebpack({}, 'generatedBundleId.js');
    const content = fs.readFileSync(`${process.cwd()}/src/test/dist/generatedBundleId.js`, 'utf8');

    // Extract the generated bundleId with a regex
    const bundleIdMatch = content.match(/__faroBundleId_webpack-test-app"\]="([^"]+)"/);

    // Verify we got a match and the bundleId is a string
    expect(typeof bundleIdMatch?.[0]).toBe('string');
    expect(bundleIdMatch?.[0]?.length).toBeGreaterThan(0);
  });

  // Test skipUpload option
  test('skipUpload option sets environment variable with bundleId', async () => {
    await runWebpack({
      bundleId: 'env-test-id',
      skipUpload: true
    });

    // Verify the environment variable was set
    expect(process.env['FARO_BUNDLE_ID_WEBPACK_TEST_APP']).toBe('env-test-id');
  });

  // Test that the bundleId code is placed at the beginning of the file
  test('bundleId is prepended to the bundle', async () => {
    await runWebpack({ bundleId: 'prepend-test' });
    const content = fs.readFileSync(`${process.cwd()}/src/test/dist/bundle.js`, 'utf8');

    // Check if the bundle starts with the injection code
    // Note: Webpack's exact output format might differ, so we check if it occurs near the beginning
    const firstCharsPos = content.indexOf('__faroBundleId_webpack-test-app');
    expect(firstCharsPos).toBeLessThan(200);
  });
});

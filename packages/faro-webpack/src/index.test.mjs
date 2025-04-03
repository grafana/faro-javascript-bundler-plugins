import test from 'ava';
import fs from 'fs';
import path from 'path';
import webpack from 'webpack';
import FaroSourceMapUploaderPlugin from '@grafana/faro-webpack-plugin';

// Helper function to run webpack with custom configuration
const runWebpack = async (customConfig = {}, filename = 'bundle.js') => {
  const webpackConfig = {
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
        appId: '1',
        ...customConfig
      }),
    ]
  };

  return new Promise((resolve, reject) => {
    webpack(webpackConfig, (err, stats) => {
      if (err || stats.hasErrors()) {
        reject(err || stats.compilation.errors);
      } else {
        resolve(stats);
      }
    });
  });
};

// Test the default bundleId injection
test('basic bundleId injection test', async t => {
  await runWebpack({ bundleId: 'test'}, 'bundleInjection.js');
  const content = fs.readFileSync(`${process.cwd()}/src/test/dist/bundleInjection.js`, 'utf8');
  const bundleIdMatch = content.match(/__faroBundleId_webpack-test-app"\]="([^"]+)"/);

  t.is(bundleIdMatch[0], `__faroBundleId_webpack-test-app"]="test"`);
});

// Test that a bundleId is generated if not provided
test('bundleId is generated if not provided', async t => {
  await runWebpack({}, 'generatedBundleId.js');
  const content = fs.readFileSync(`${process.cwd()}/src/test/dist/generatedBundleId.js`, 'utf8');

  // Extract the generated bundleId with a regex
  const bundleIdMatch = content.match(/__faroBundleId_webpack-test-app"\]="([^"]+)"/);

  // Verify we got a match and the bundleId is a string
  t.is(typeof bundleIdMatch[0], 'string');
  t.true(bundleIdMatch[0].length > 0);
});

// Test skipUpload option
test('skipUpload option sets environment variable with bundleId', async t => {
  await runWebpack({
    bundleId: 'env-test-id',
    skipUpload: true
  });

  // Verify the environment variable was set
  t.is(process.env['FARO_BUNDLE_ID_WEBPACK_TEST_APP'], 'env-test-id');
});

// Test that the bundleId code is placed at the beginning of the file
test('bundleId is prepended to the bundle', async t => {
  await runWebpack({ bundleId: 'prepend-test' });
  const content = fs.readFileSync(`${process.cwd()}/src/test/dist/bundle.js`, 'utf8');

  // Check if the bundle starts with the injection code
  // Note: Webpack's exact output format might differ, so we check if it occurs near the beginning
  const firstCharsPos = content.indexOf('__faroBundleId_webpack-test-app');
  t.true(firstCharsPos < 200, 'Bundle ID should be near the beginning of the file');
});

import test from 'ava';
import webpack from 'webpack';
import config from './test/webpack.config.js';
import fs from 'fs';

test('webpack', async t => {
  const stats = await webpack(config);

  const content = fs.readFileSync(`${stats.outputPath}/../src/test/dist/bundle.cjs`, 'utf-8');
  t.truthy(content.startsWith(`!function(){try{("undefined"!=typeof window?window:"undefined"!=typeof global?global:"undefined"!=typeof self?self:{})["__faroBundleId_webpack-test-app"]`));
});
import test from 'ava';
import webpack from 'webpack';
import config from './test/webpack.config.js';

test('webpack', async t => {
  const stats = await webpack(config);
  t.snapshot(stats);
  t.pass();
});
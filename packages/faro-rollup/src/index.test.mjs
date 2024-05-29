import test from 'ava';
import { rollup } from 'rollup';
import { config } from './test/rollup.config.mjs';

test('rollup', async t => {
  const bundle = await rollup(config);
  const output = await bundle.write(config.output);

  t.truthy(output.output[0].code.startsWith(`(function(){try{var g=typeof window!=="undefined"?window:typeof global!=="undefined"?global:typeof self!=="undefined"?self:{};g["__faroBundleId_rollup-test-app"]="test"`));
});
import test from 'ava';
import fs from 'fs';

test('webpack', async t => {
  const content = fs.readFileSync(`${process.cwd()}/src/test/dist/bundle.js`, 'utf8');

  t.truthy(content.startsWith(`!function(){try{("undefined"!=typeof window?window:"undefined"!=typeof global?global:"undefined"!=typeof self?self:{})["__faroBundleId_webpack-test-app"]="test"`));
});

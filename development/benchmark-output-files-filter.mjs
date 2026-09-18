import { performance } from 'node:perf_hooks';

import {
  createSourceMapFileFilter,
  shouldProcessFile,
} from '../packages/faro-bundlers-shared/dist/esm/index.mjs';

const sourcemapCount = Number(process.env.BENCH_FILTER_SOURCEMAPS ?? 20000);
const fillerCount = Number(process.env.BENCH_FILTER_FILLER ?? 20000);
const outputFilesCount = Number(process.env.BENCH_FILTER_OUTPUT_FILES ?? 10000);

function formatMs(value) {
  return Number(value.toFixed(2));
}

const filenames = [
  ...Array.from({ length: sourcemapCount }, (_, index) => `chunk-${index}.js.map`),
  ...Array.from({ length: fillerCount }, (_, index) => `asset-${index}.txt`),
];
const outputFiles = Array.from(
  { length: outputFilesCount },
  (_, index) => `chunk-${index}.js`
);

function measure(fn) {
  const started = performance.now();
  let matched = 0;

  for (const filename of filenames) {
    if (fn(filename)) {
      matched += 1;
    }
  }

  return { matched, ms: performance.now() - started };
}

const before = measure((filename) => {
  if (!/\.(js|ts|jsx|tsx|mjs|cjs)\.map$|\.(bundle|jsbundle)\.map$/.test(filename)) {
    return false;
  }

  return outputFiles.map((outputFile) => `${outputFile}.map`).includes(filename);
});
const currentPublicHelper = measure((filename) => shouldProcessFile(filename, outputFiles));
const compiledFilter = createSourceMapFileFilter(outputFiles);
const compiled = measure(compiledFilter);

console.log(
  JSON.stringify(
    {
      sourcemapCount,
      fillerCount,
      outputFilesCount,
      beforeMs: formatMs(before.ms),
      currentPublicHelperMs: formatMs(currentPublicHelper.ms),
      compiledFilterMs: formatMs(compiled.ms),
      matched: compiled.matched,
      compiledDeltaPercent: formatMs(((compiled.ms - before.ms) / before.ms) * 100),
    },
    null,
    2
  )
);

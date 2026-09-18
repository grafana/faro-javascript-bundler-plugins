import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import {
  findSourceMapFiles,
  modifySourceMapFileProperty,
  shouldProcessFile,
} from '../packages/faro-bundlers-shared/dist/esm/index.mjs';

const runs = Number(process.env.BENCH_RUNS ?? 5);
const sourcemapCount = Number(process.env.BENCH_SOURCEMAPS ?? 1000);
const jsCount = Number(process.env.BENCH_JS ?? sourcemapCount);
const fillerCount = Number(process.env.BENCH_FILLER ?? 1000);
const mapPayloadBytes = Number(process.env.BENCH_MAP_PAYLOAD_BYTES ?? 4096);
const prefixPath = 'cdn/assets';

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function formatMs(value) {
  return Number(value.toFixed(2));
}

function normalizePrefix(prefix) {
  return prefix.endsWith('/') ? prefix : `${prefix}/`;
}

function writeFixture(root) {
  fs.mkdirSync(root, { recursive: true });

  for (let i = 0; i < jsCount; i++) {
    const name = `chunk-${i}.js`;
    fs.writeFileSync(
      path.join(root, name),
      `console.log(${i});\n//# sourceMappingURL=${name}.map`
    );
  }

  for (let i = 0; i < sourcemapCount; i++) {
    const hasFile = i % 2 === 0;
    const map = {
      version: 3,
      ...(hasFile ? { file: `assets/chunk-${i}.js` } : {}),
      sources: [`src/chunk-${i}.ts`],
      names: [],
      mappings: 'A'.repeat(mapPayloadBytes),
    };
    fs.writeFileSync(path.join(root, `chunk-${i}.js.map`), JSON.stringify(map));
  }

  for (let i = 0; i < fillerCount; i++) {
    fs.writeFileSync(path.join(root, `asset-${i}.txt`), 'x');
  }
}

function oldEnsureSourceMapFileProperty(filePath) {
  const sourceMap = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  if (!sourceMap.file) {
    sourceMap.file = path.basename(filePath).replace(/\.map$/, '');
    fs.writeFileSync(filePath, JSON.stringify(sourceMap));
  }
}

function oldModifySourceMapFileProperty(filePath, prefix) {
  oldEnsureSourceMapFileProperty(filePath);

  const normalizedPrefix = normalizePrefix(prefix);
  const sourceMap = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  if (sourceMap.file && !sourceMap.file.startsWith(normalizedPrefix)) {
    sourceMap.file = `${normalizedPrefix}${sourceMap.file}`;
    fs.writeFileSync(filePath, JSON.stringify(sourceMap));
  }
}

function oldEsbuildPrefixProcessing(outputDir) {
  const filenamesForEnsure = fs.readdirSync(outputDir, { recursive: false });

  for (const filename of filenamesForEnsure) {
    const filenameStr = filename.toString();
    const filePath = path.join(outputDir, filenameStr);

    if (!shouldProcessFile(filenameStr, undefined)) {
      continue;
    }

    if (fs.existsSync(filePath)) {
      oldEnsureSourceMapFileProperty(filePath);
    }
  }

  const filenamesForPrefix = fs.readdirSync(outputDir, { recursive: false });

  for (const filename of filenamesForPrefix) {
    const filenameStr = filename.toString();
    const filePath = path.join(outputDir, filenameStr);

    if (!shouldProcessFile(filenameStr, undefined)) {
      continue;
    }

    if (fs.existsSync(filePath)) {
      oldModifySourceMapFileProperty(filePath, prefixPath);
    }
  }
}

function newEsbuildPrefixProcessing(outputDir) {
  const sourceMapFiles = findSourceMapFiles(outputDir, undefined, false);

  for (const { filePath } of sourceMapFiles) {
    modifySourceMapFileProperty(filePath, prefixPath, false, false);
  }
}

function oldWebpackUploadEnumeration(outputDir, gzipContents) {
  const filenames = fs.readdirSync(outputDir, { recursive: false });
  let totalSize = 0;
  let matched = 0;

  for (const filename of filenames) {
    const filenameStr = filename.toString();
    const filePath = path.join(outputDir, filenameStr);

    if (!shouldProcessFile(filenameStr, undefined)) {
      continue;
    }

    if (gzipContents && fs.existsSync(filePath)) {
      totalSize += fs.statSync(filePath).size;
    }

    matched += 1;
  }

  return { matched, totalSize };
}

function newWebpackUploadEnumeration(outputDir, gzipContents) {
  const sourceMapFiles = findSourceMapFiles(
    outputDir,
    undefined,
    false,
    gzipContents
  );

  return {
    matched: sourceMapFiles.length,
    totalSize: sourceMapFiles.reduce((sum, file) => sum + (file.size ?? 0), 0),
  };
}

function oldRollupPrefixProcessing(outputDir) {
  const filenames = fs.readdirSync(outputDir, { recursive: true });

  for (const filename of filenames) {
    const filenameStr = filename.toString();

    if (!shouldProcessFile(filenameStr, undefined)) {
      continue;
    }

    const filePath = path.join(outputDir, filenameStr);

    if (fs.existsSync(filePath)) {
      oldModifySourceMapFileProperty(filePath, prefixPath);
    }
  }
}

function newRollupPrefixProcessing(outputDir) {
  const sourceMapFiles = findSourceMapFiles(outputDir, undefined, true);

  for (const { filePath } of sourceMapFiles) {
    modifySourceMapFileProperty(filePath, prefixPath, false, false);
  }
}

function timeScenario(fn) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'faro-bench-'));
  writeFixture(tempRoot);

  const started = performance.now();
  fn(tempRoot);
  const elapsed = performance.now() - started;

  fs.rmSync(tempRoot, { recursive: true, force: true });
  return elapsed;
}

function runScenario(name, beforeFn, afterFn) {
  const before = [];
  const after = [];

  for (let i = 0; i < runs; i++) {
    before.push(timeScenario(beforeFn));
    after.push(timeScenario(afterFn));
  }

  const beforeMedian = median(before);
  const afterMedian = median(after);

  return {
    name,
    beforeMedianMs: formatMs(beforeMedian),
    afterMedianMs: formatMs(afterMedian),
    deltaPercent: formatMs(((afterMedian - beforeMedian) / beforeMedian) * 100),
    beforeTimingsMs: before.map(formatMs),
    afterTimingsMs: after.map(formatMs),
  };
}

const scenarios = [
  runScenario(
    'esbuild prefix processing',
    oldEsbuildPrefixProcessing,
    newEsbuildPrefixProcessing
  ),
  runScenario(
    'webpack upload enumeration, gzipContents=false',
    (outputDir) => oldWebpackUploadEnumeration(outputDir, false),
    (outputDir) => newWebpackUploadEnumeration(outputDir, false)
  ),
  runScenario(
    'webpack upload enumeration, gzipContents=true',
    (outputDir) => oldWebpackUploadEnumeration(outputDir, true),
    (outputDir) => newWebpackUploadEnumeration(outputDir, true)
  ),
  runScenario(
    'rollup prefix processing',
    oldRollupPrefixProcessing,
    newRollupPrefixProcessing
  ),
];

console.log(
  JSON.stringify(
    {
      runs,
      sourcemapCount,
      jsCount,
      fillerCount,
      mapPayloadBytes,
      scenarios,
    },
    null,
    2
  )
);

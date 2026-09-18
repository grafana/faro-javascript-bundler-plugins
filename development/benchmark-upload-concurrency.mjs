import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import {
  uploadIndividualSourceMaps,
  uploadSourceMap,
} from '../packages/faro-bundlers-shared/dist/esm/index.mjs';

const fileCount = Number(process.env.BENCH_UPLOAD_FILES ?? 20);
const responseDelayMs = Number(process.env.BENCH_UPLOAD_DELAY_MS ?? 50);
const uploadConcurrency = Number(process.env.BENCH_UPLOAD_CONCURRENCY ?? 5);

function formatMs(value) {
  return Number(value.toFixed(2));
}

function createFixtureFiles(root) {
  fs.mkdirSync(root, { recursive: true });

  return Array.from({ length: fileCount }, (_, index) => {
    const filename = `chunk-${index}.js.map`;
    const filePath = path.join(root, filename);
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        version: 3,
        file: `chunk-${index}.js`,
        sources: [`chunk-${index}.ts`],
        names: [],
        mappings: 'AAAA',
      })
    );
    return { filename, filePath };
  });
}

function startDelayedServer() {
  let requestCount = 0;
  const server = http.createServer((request, response) => {
    request.resume();
    requestCount += 1;

    setTimeout(() => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{}');
    }, responseDelayMs);
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        endpoint: `http://127.0.0.1:${address.port}/upload`,
        close: () => new Promise((closeResolve) => server.close(closeResolve)),
        getRequestCount: () => requestCount,
      });
    });
  });
}

async function uploadSequentially(endpoint, files) {
  for (const file of files) {
    await uploadSourceMap({
      sourcemapEndpoint: endpoint,
      apiKey: 'key',
      stackId: 'stack',
      filename: file.filename,
      filePath: file.filePath,
      keepSourcemaps: true,
    });
  }
}

async function measure(fn) {
  const started = performance.now();
  await fn();
  return performance.now() - started;
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'faro-upload-bench-'));
const files = createFixtureFiles(tempRoot);
const server = await startDelayedServer();

try {
  const beforeMs = await measure(() => uploadSequentially(server.endpoint, files));
  const afterMs = await measure(() =>
    uploadIndividualSourceMaps({
      sourcemapEndpoint: server.endpoint,
      apiKey: 'key',
      stackId: 'stack',
      files,
      keepSourcemaps: true,
      uploadConcurrency,
    })
  );

  console.log(
    JSON.stringify(
      {
        fileCount,
        responseDelayMs,
        uploadConcurrency,
        requestCount: server.getRequestCount(),
        sequentialMs: formatMs(beforeMs),
        concurrentMs: formatMs(afterMs),
        deltaPercent: formatMs(((afterMs - beforeMs) / beforeMs) * 100),
      },
      null,
      2
    )
  );
} finally {
  await server.close();
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

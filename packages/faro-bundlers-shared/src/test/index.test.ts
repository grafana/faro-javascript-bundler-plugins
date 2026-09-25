import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  faroBundleIdSnippet,
  randomString,
  shouldProcessFile,
  exportBundleIdToFile,
  normalizePrefix,
  modifySourceMapFileProperty,
  ensureSourceMapFileProperty,
  ensureSourceMapFileProperties,
  findSourceMapFiles,
  createSourceMapFileFilter,
  isLocalEndpoint,
  uploadIndividualSourceMaps,
  type SourceMapFile,
} from '../index';

vi.mock('undici', () => ({
  fetch: vi.fn(),
  ProxyAgent: vi.fn(),
}));

const { fetch } = await import('undici');
const fetchMock = vi.mocked(fetch);



// Store original env to restore after tests
let originalEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  // Save the original environment variables
  originalEnv = { ...process.env };
});

afterEach(() => {
  // Restore original environment variables
  process.env = originalEnv;
  vi.clearAllMocks();
  for (const envFile of ['.env.TEST_APP', '.env.TEST_APP_WITH_SPECIAL_CHARS___']) {
    const envFilePath = path.resolve(process.cwd(), envFile);
    if (fs.existsSync(envFilePath)) {
      fs.unlinkSync(envFilePath);
    }
  }
});

const createSourceMapFiles = (tempDir: string, count: number): SourceMapFile[] =>
  Array.from({ length: count }, (_, index) => {
    const filename = `bundle-${index}.js.map`;
    const filePath = path.join(tempDir, filename);
    fs.writeFileSync(filePath, filename);

    return { filename, filePath };
  });

const uploadSourceMaps = (
  files: SourceMapFile[],
  uploadConcurrency?: number
): Promise<string[]> =>
  uploadIndividualSourceMaps({
    sourcemapEndpoint: 'https://example.com/faro/api/v1/sourcemaps',
    apiKey: 'api-key',
    stackId: 'stack-id',
    files,
    keepSourcemaps: true,
    uploadConcurrency,
  });

const sorted = (values: string[]): string[] => [...values].sort();

const trackConcurrentUploads = (successfulFilenames = new Set<string>()) => {
  let activeUploads = 0;
  let maxActiveUploads = 0;
  const uploadedFilenames: string[] = [];

  fetchMock.mockImplementation(async (_url, options) => {
    activeUploads += 1;
    maxActiveUploads = Math.max(maxActiveUploads, activeUploads);

    await new Promise((resolve) => setTimeout(resolve, 0));

    const filename = options?.body?.toString() ?? '';
    uploadedFilenames.push(filename);
    activeUploads -= 1;
    const ok = successfulFilenames.size === 0 || successfulFilenames.has(filename);

    return {
      ok,
      status: ok ? 200 : 500,
    } as Awaited<ReturnType<typeof fetch>>;
  });

  return {
    getMaxActiveUploads: () => maxActiveUploads,
    uploadedFilenames,
  };
};

describe('uploadIndividualSourceMaps', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(process.cwd(), 'test-temp-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('honors the upload concurrency cap and uploads every source map once', async () => {
    const files = createSourceMapFiles(tempDir, 7);
    const tracker = trackConcurrentUploads();

    const uploadedFilenames = await uploadSourceMaps(files, 2);

    expect(fetchMock).toHaveBeenCalledTimes(files.length);
    expect(tracker.getMaxActiveUploads()).toBe(2);
    expect(sorted(tracker.uploadedFilenames)).toEqual(
      sorted(files.map((file) => file.filename))
    );
    expect(new Set(tracker.uploadedFilenames)).toHaveLength(files.length);
    expect(sorted(uploadedFilenames)).toEqual(
      sorted(files.map((file) => file.filename))
    );
  });

  test.each([undefined, 0, -1, Number.NaN])(
    'falls back to the default concurrency for %s',
    async (uploadConcurrency) => {
      const files = createSourceMapFiles(tempDir, 8);
      const tracker = trackConcurrentUploads();

      await uploadSourceMaps(files, uploadConcurrency);

      expect(tracker.getMaxActiveUploads()).toBe(5);
    }
  );

  test('floors fractional upload concurrency values', async () => {
    const files = createSourceMapFiles(tempDir, 5);
    const tracker = trackConcurrentUploads();

    await uploadSourceMaps(files, 2.9);

    expect(tracker.getMaxActiveUploads()).toBe(2);
  });

  test('does not create more workers than there are source maps', async () => {
    const files = createSourceMapFiles(tempDir, 3);
    const tracker = trackConcurrentUploads();

    await uploadSourceMaps(files, 20);

    expect(tracker.getMaxActiveUploads()).toBe(files.length);
  });

  test('returns only successfully uploaded filenames', async () => {
    const consoleInfoSpy = vi
      .spyOn(console, 'info')
      .mockImplementation(() => undefined);
    const files = createSourceMapFiles(tempDir, 4);
    const successfulFilenames = new Set([
      files[0].filename,
      files[2].filename,
    ]);
    const tracker = trackConcurrentUploads(successfulFilenames);

    const uploadedFilenames = await uploadSourceMaps(files, 3);

    expect(sorted(tracker.uploadedFilenames)).toEqual(
      sorted(files.map((file) => file.filename))
    );
    expect(sorted(uploadedFilenames)).toEqual(
      sorted([...successfulFilenames])
    );

    consoleInfoSpy.mockRestore();
  });

  test('waits for remaining workers and returns successful filenames when one file disappears', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const files = createSourceMapFiles(tempDir, 4);
    fs.unlinkSync(files[1].filePath);
    const tracker = trackConcurrentUploads();

    const uploadedFilenames = await uploadSourceMaps(files, 2);
    const expectedUploadedFilenames = [
      files[0].filename,
      files[2].filename,
      files[3].filename,
    ];

    expect(fetchMock).toHaveBeenCalledTimes(expectedUploadedFilenames.length);
    expect(sorted(tracker.uploadedFilenames)).toEqual(
      sorted(expectedUploadedFilenames)
    );
    expect(sorted(uploadedFilenames)).toEqual(
      sorted(expectedUploadedFilenames)
    );

    consoleErrorSpy.mockRestore();
  });
});

describe('Bundlers Shared Utilities', () => {
  test('faroBundleIdSnippet generates correct code snippet', () => {
    const bundleId = 'test-id';
    const appName = 'test-app';
    const snippet = faroBundleIdSnippet(bundleId, appName);

    expect(snippet).toContain(`g["__faroBundleId_${appName}"]="${bundleId}"`);
    expect(snippet.startsWith('(function(){try{')).toBeTruthy();
    expect(snippet.endsWith('})();')).toBeTruthy();
  });

  test('randomString generates string of correct length', () => {
    const length = 5;
    const result = randomString(length);

    // Each byte becomes 2 hex characters
    expect(result.length).toBe(length * 2);
    // Should be a hexadecimal string
    expect(result).toMatch(/^[0-9a-f]+$/);
  });

  test('randomString uses default length if not specified', () => {
    const result = randomString();

    // Default length is 10 bytes = 20 hex chars
    expect(result.length).toBe(20);
    expect(result).toMatch(/^[0-9a-f]+$/);
  });

  test('shouldProcessFile correctly identifies JavaScript sourcemaps', () => {
    expect(shouldProcessFile('bundle.js.map', undefined)).toBeTruthy();
    expect(shouldProcessFile('app.ts.map', undefined)).toBeTruthy();
    expect(shouldProcessFile('component.jsx.map', undefined)).toBeTruthy();
    expect(shouldProcessFile('main.tsx.map', undefined)).toBeTruthy();
    expect(shouldProcessFile('module.mjs.map', undefined)).toBeTruthy();
    expect(shouldProcessFile('lib.cjs.map', undefined)).toBeTruthy();
    expect(shouldProcessFile('index.android.bundle.map', undefined)).toBeTruthy();
    expect(shouldProcessFile('main.jsbundle.map', undefined)).toBeTruthy();

    // Non-sourcemap files
    expect(shouldProcessFile('styles.css.map', undefined)).toBeFalsy();
    expect(shouldProcessFile('bundle.js', undefined)).toBeFalsy();
  });

  test('shouldProcessFile respects regex filter', () => {
    const regexFilter = /app\..*\.map$/;

    expect(shouldProcessFile('app.js.map', regexFilter)).toBeTruthy();
    expect(shouldProcessFile('app.tsx.map', regexFilter)).toBeTruthy();
    expect(shouldProcessFile('bundle.js.map', regexFilter)).toBeFalsy();
  });

  test('shouldProcessFile respects array filter', () => {
    const arrayFilter = ['bundle.js', 'app.js'];

    expect(shouldProcessFile('bundle.js.map', arrayFilter)).toBeTruthy();
    expect(shouldProcessFile('app.js.map', arrayFilter)).toBeTruthy();
    expect(shouldProcessFile('module.js.map', arrayFilter)).toBeFalsy();
  });

  test('createSourceMapFileFilter respects array filter', () => {
    const filter = createSourceMapFileFilter(['bundle.js', 'app.js']);

    expect(filter('bundle.js.map')).toBeTruthy();
    expect(filter('app.js.map')).toBeTruthy();
    expect(filter('module.js.map')).toBeFalsy();
    expect(filter('bundle.js')).toBeFalsy();
  });

  test('createSourceMapFileFilter respects regex filter', () => {
    const filter = createSourceMapFileFilter(/app\..*\.map$/);

    expect(filter('app.js.map')).toBeTruthy();
    expect(filter('bundle.js.map')).toBeFalsy();
    expect(filter('styles.css.map')).toBeFalsy();
  });

  test('exportBundleIdToFile sets environment variable', () => {
    const bundleId = 'test-bundle-id';
    const appName = 'test-app';

    exportBundleIdToFile(bundleId, appName, false);

    expect(fs.readFileSync(path.resolve(process.cwd(), '.env.TEST_APP'), 'utf8')).toBe(`FARO_BUNDLE_ID_TEST_APP=${bundleId}\n`);
  });

  test('exportBundleIdToFile sanitizes app name for environment variable', () => {
    const bundleId = 'test-bundle-id';
    const appName = 'test-app-with-special-chars!@#';

    exportBundleIdToFile(bundleId, appName, false);

    expect(fs.readFileSync(path.resolve(process.cwd(), '.env.TEST_APP_WITH_SPECIAL_CHARS___'), 'utf8')).toBe(
      `FARO_BUNDLE_ID_TEST_APP_WITH_SPECIAL_CHARS___=${bundleId}\n`
    );
  });

  test('normalizePrefix adds trailing slash when missing', () => {
    expect(normalizePrefix('robo/assets')).toBe('robo/assets/');
    expect(normalizePrefix('_next')).toBe('_next/');
    expect(normalizePrefix('custom/path')).toBe('custom/path/');
  });

  test('normalizePrefix preserves trailing slash when present', () => {
    expect(normalizePrefix('robo/assets/')).toBe('robo/assets/');
    expect(normalizePrefix('_next/')).toBe('_next/');
    expect(normalizePrefix('custom/path/')).toBe('custom/path/');
  });

  test('modifySourceMapFileProperty prepends prefix to file property', () => {
    const tempDir = fs.mkdtempSync(path.join(process.cwd(), 'test-temp-'));
    const sourceMapPath = path.join(tempDir, 'test.js.map');

    const sourceMap = {
      version: 3,
      file: 'test.js',
      sources: ['test.ts'],
      mappings: 'AAAA',
    };

    fs.writeFileSync(sourceMapPath, JSON.stringify(sourceMap, null, 2));

    modifySourceMapFileProperty(sourceMapPath, 'robo/assets', false);

    const modifiedSourceMap = JSON.parse(fs.readFileSync(sourceMapPath, 'utf8'));
    expect(modifiedSourceMap.file).toBe('robo/assets/test.js');

    // cleanup
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('modifySourceMapFileProperty does not double-prefix', () => {
    const tempDir = fs.mkdtempSync(path.join(process.cwd(), 'test-temp-'));
    const sourceMapPath = path.join(tempDir, 'test.js.map');

    const sourceMap = {
      version: 3,
      file: 'robo/assets/test.js',
      sources: ['test.ts'],
      mappings: 'AAAA',
    };

    fs.writeFileSync(sourceMapPath, JSON.stringify(sourceMap, null, 2));

    modifySourceMapFileProperty(sourceMapPath, 'robo/assets', false);

    const modifiedSourceMap = JSON.parse(fs.readFileSync(sourceMapPath, 'utf8'));
    expect(modifiedSourceMap.file).toBe('robo/assets/test.js');

    // cleanup
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('modifySourceMapFileProperty normalizes prefix without trailing slash', () => {
    const tempDir = fs.mkdtempSync(path.join(process.cwd(), 'test-temp-'));
    const sourceMapPath = path.join(tempDir, 'test.js.map');

    const sourceMap = {
      version: 3,
      file: 'test.js',
      sources: ['test.ts'],
      mappings: 'AAAA',
    };

    fs.writeFileSync(sourceMapPath, JSON.stringify(sourceMap, null, 2));

    modifySourceMapFileProperty(sourceMapPath, 'robo/assets', false);

    const modifiedSourceMap = JSON.parse(fs.readFileSync(sourceMapPath, 'utf8'));
    expect(modifiedSourceMap.file).toBe('robo/assets/test.js');

    // cleanup
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('modifySourceMapFileProperty strips directory path when prefixPathBasenameOnly is true', () => {
    const tempDir = fs.mkdtempSync(path.join(process.cwd(), 'test-temp-'));
    const sourceMapPath = path.join(tempDir, 'index-DWRl9wIG.js.map');

    const sourceMap = {
      version: 3,
      file: 'assets/index-DWRl9wIG.js',
      sources: ['index.ts'],
      mappings: 'AAAA',
    };

    fs.writeFileSync(sourceMapPath, JSON.stringify(sourceMap, null, 2));

    modifySourceMapFileProperty(sourceMapPath, 'https://cdn.example.com/assets/', false, true);

    const modifiedSourceMap = JSON.parse(fs.readFileSync(sourceMapPath, 'utf8'));
    expect(modifiedSourceMap.file).toBe('https://cdn.example.com/assets/index-DWRl9wIG.js');

    // cleanup
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('modifySourceMapFileProperty derives missing file property before prefixing', () => {
    const tempDir = fs.mkdtempSync(path.join(process.cwd(), 'test-temp-'));
    const sourceMapPath = path.join(tempDir, 'bundle.js.map');

    const sourceMap = {
      version: 3,
      sources: ['test.ts'],
      mappings: 'AAAA',
    };

    fs.writeFileSync(sourceMapPath, JSON.stringify(sourceMap, null, 2));

    modifySourceMapFileProperty(sourceMapPath, 'robo/assets', false);

    const modifiedSourceMap = JSON.parse(fs.readFileSync(sourceMapPath, 'utf8'));
    expect(modifiedSourceMap.file).toBe('robo/assets/bundle.js');

    // cleanup
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('modifySourceMapFileProperty preserves directory path when prefixPathBasenameOnly is false', () => {
    const tempDir = fs.mkdtempSync(path.join(process.cwd(), 'test-temp-'));
    const sourceMapPath = path.join(tempDir, 'index-DWRl9wIG.js.map');

    const sourceMap = {
      version: 3,
      file: 'assets/index-DWRl9wIG.js',
      sources: ['index.ts'],
      mappings: 'AAAA',
    };

    fs.writeFileSync(sourceMapPath, JSON.stringify(sourceMap, null, 2));

    modifySourceMapFileProperty(sourceMapPath, 'https://cdn.example.com/robo/', false, false);

    const modifiedSourceMap = JSON.parse(fs.readFileSync(sourceMapPath, 'utf8'));
    expect(modifiedSourceMap.file).toBe('https://cdn.example.com/robo/assets/index-DWRl9wIG.js');

    // cleanup
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('ensureSourceMapFileProperty adds file property when missing', () => {
    const tempDir = fs.mkdtempSync(path.join(process.cwd(), 'test-temp-'));
    const sourceMapPath = path.join(tempDir, 'bundle.js.map');

    const sourceMap = {
      version: 3,
      sources: ['test.ts'],
      mappings: 'AAAA',
      // file property is missing
    };

    fs.writeFileSync(sourceMapPath, JSON.stringify(sourceMap, null, 2));

    ensureSourceMapFileProperty(sourceMapPath, false);

    const modifiedSourceMap = JSON.parse(fs.readFileSync(sourceMapPath, 'utf8'));
    expect(modifiedSourceMap.file).toBe('bundle.js');

    // cleanup
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('ensureSourceMapFileProperty does not modify existing file property', () => {
    const tempDir = fs.mkdtempSync(path.join(process.cwd(), 'test-temp-'));
    const sourceMapPath = path.join(tempDir, 'bundle.js.map');

    const sourceMap = {
      version: 3,
      file: 'custom.js',
      sources: ['test.ts'],
      mappings: 'AAAA',
    };

    fs.writeFileSync(sourceMapPath, JSON.stringify(sourceMap, null, 2));

    ensureSourceMapFileProperty(sourceMapPath, false);

    const modifiedSourceMap = JSON.parse(fs.readFileSync(sourceMapPath, 'utf8'));
    expect(modifiedSourceMap.file).toBe('custom.js');

    // cleanup
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});

describe('findSourceMapFiles', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(process.cwd(), 'test-temp-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('finds JavaScript source maps', () => {
    fs.writeFileSync(path.join(tempDir, 'bundle.js.map'), '{}');
    fs.writeFileSync(path.join(tempDir, 'styles.css.map'), '{}');

    const result = findSourceMapFiles(tempDir, undefined);

    expect(result).toEqual([
      {
        filename: 'bundle.js.map',
        filePath: path.join(tempDir, 'bundle.js.map'),
      },
    ]);
  });

  test('includes source map sizes when requested', () => {
    fs.writeFileSync(path.join(tempDir, 'bundle.js.map'), '{}');

    const result = findSourceMapFiles(tempDir, undefined, false, true);

    expect(result).toEqual([
      {
        filename: 'bundle.js.map',
        filePath: path.join(tempDir, 'bundle.js.map'),
        size: 2,
      },
    ]);
  });

  test('finds source maps recursively when requested', () => {
    const nestedDir = path.join(tempDir, 'nested');
    fs.mkdirSync(nestedDir);
    fs.writeFileSync(path.join(nestedDir, 'bundle.js.map'), '{}');

    const result = findSourceMapFiles(tempDir, undefined, true);

    expect(result).toEqual([
      {
        filename: path.join('nested', 'bundle.js.map'),
        filePath: path.join(tempDir, 'nested', 'bundle.js.map'),
      },
    ]);
  });
});

describe('ensureSourceMapFileProperties', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(process.cwd(), 'test-temp-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('sets file property from matching JS sourceMappingURL', () => {
    // Standard case: JS and map have the same basename
    fs.writeFileSync(
      path.join(tempDir, 'bundle.js'),
      'console.log("hello");\n//# sourceMappingURL=bundle.js.map'
    );
    fs.writeFileSync(
      path.join(tempDir, 'bundle.js.map'),
      JSON.stringify({ version: 3, sources: ['test.ts'], mappings: 'AAAA' })
    );

    ensureSourceMapFileProperties(tempDir);

    const result = JSON.parse(fs.readFileSync(path.join(tempDir, 'bundle.js.map'), 'utf8'));
    expect(result.file).toBe('bundle.js');
  });

  test('sets file property with mismatched JS and map hashes (Turbopack)', () => {
    // Turbopack case: JS hash differs from map hash
    fs.writeFileSync(
      path.join(tempDir, '68e2072d.js'),
      'console.log("hello");\n//# sourceMappingURL=b4235de6.js.map'
    );
    fs.writeFileSync(
      path.join(tempDir, 'b4235de6.js.map'),
      JSON.stringify({ version: 3, sources: ['test.ts'], mappings: 'AAAA' })
    );

    ensureSourceMapFileProperties(tempDir);

    const result = JSON.parse(fs.readFileSync(path.join(tempDir, 'b4235de6.js.map'), 'utf8'));
    expect(result.file).toBe('68e2072d.js');
  });

  test('does not modify existing correct file property', () => {
    fs.writeFileSync(
      path.join(tempDir, 'app.js'),
      'console.log("hello");\n//# sourceMappingURL=app.js.map'
    );
    const original = JSON.stringify({ version: 3, file: 'app.js', sources: ['test.ts'], mappings: 'AAAA' });
    fs.writeFileSync(path.join(tempDir, 'app.js.map'), original);

    ensureSourceMapFileProperties(tempDir);

    const content = fs.readFileSync(path.join(tempDir, 'app.js.map'), 'utf8');
    // File should not be rewritten (content unchanged)
    expect(content).toBe(original);
  });

  test('falls back to deriving file from map filename for orphan maps', () => {
    // No JS file references this map
    fs.writeFileSync(
      path.join(tempDir, 'orphan.js.map'),
      JSON.stringify({ version: 3, sources: ['test.ts'], mappings: 'AAAA' })
    );

    ensureSourceMapFileProperties(tempDir);

    const result = JSON.parse(fs.readFileSync(path.join(tempDir, 'orphan.js.map'), 'utf8'));
    expect(result.file).toBe('orphan.js');
  });

  test('does not overwrite existing file property even if it differs from JS reference', () => {
    fs.writeFileSync(
      path.join(tempDir, 'real.js'),
      'console.log("hello");\n//# sourceMappingURL=map123.js.map'
    );
    fs.writeFileSync(
      path.join(tempDir, 'map123.js.map'),
      JSON.stringify({ version: 3, file: 'map123.js', sources: ['test.ts'], mappings: 'AAAA' })
    );

    ensureSourceMapFileProperties(tempDir);

    const result = JSON.parse(fs.readFileSync(path.join(tempDir, 'map123.js.map'), 'utf8'));
    expect(result.file).toBe('map123.js');
  });
});

describe('isLocalEndpoint', () => {
  test('returns true for localhost variants', () => {
    expect(isLocalEndpoint('http://localhost:8000/faro/api/v1')).toBe(true);
    expect(isLocalEndpoint('http://LOCALHOST:8000')).toBe(true);
    expect(isLocalEndpoint('http://127.0.0.1:8000/api')).toBe(true);
    expect(isLocalEndpoint('http://[::1]:8000')).toBe(true);
    expect(isLocalEndpoint('http://0.0.0.0:8000')).toBe(true);
  });

  test('returns true for RFC 1918 private IPv4 ranges', () => {
    // Android emulator loopback to host
    expect(isLocalEndpoint('http://10.0.2.2:8000/faro/api/v1')).toBe(true);
    expect(isLocalEndpoint('http://10.255.255.255/api')).toBe(true);
    // Docker bridge / common LAN
    expect(isLocalEndpoint('http://172.17.0.1:8000')).toBe(true);
    expect(isLocalEndpoint('http://172.31.255.1:8000')).toBe(true);
    expect(isLocalEndpoint('http://192.168.1.10:8000')).toBe(true);
  });

  test('returns false for production Grafana Cloud endpoints', () => {
    expect(isLocalEndpoint('https://faro-api-prod-us-east-0.grafana.net/faro/api/v1')).toBe(false);
    expect(isLocalEndpoint('https://example.grafana.net/api')).toBe(false);
    expect(isLocalEndpoint('https://my-stack.grafana.net')).toBe(false);
  });

  test('returns false for public IPv4 addresses that fall outside private ranges', () => {
    // 172.15.x.x and 172.32.x.x are public — must NOT match the 172.16/12 block check.
    expect(isLocalEndpoint('http://172.15.0.1:8000')).toBe(false);
    expect(isLocalEndpoint('http://172.32.0.1:8000')).toBe(false);
    // 11.x.x.x and 9.x.x.x are public.
    expect(isLocalEndpoint('http://11.0.0.1:8000')).toBe(false);
    expect(isLocalEndpoint('http://9.255.255.255:8000')).toBe(false);
  });

  test('returns false for unparseable input', () => {
    expect(isLocalEndpoint('not a url')).toBe(false);
    expect(isLocalEndpoint('')).toBe(false);
  });
});

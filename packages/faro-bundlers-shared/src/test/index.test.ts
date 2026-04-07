import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
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
} from '../index';



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

  test('exportBundleIdToFile sets environment variable', () => {
    const bundleId = 'test-bundle-id';
    const appName = 'test-app';

    exportBundleIdToFile(bundleId, appName, false);

    expect(fs.readFileSync(path.resolve(process.cwd(), '.env.TEST_APP'), 'utf8')).toBe(`FARO_BUNDLE_ID_TEST_APP=${bundleId}`);
  });

  test('exportBundleIdToFile sanitizes app name for environment variable', () => {
    const bundleId = 'test-bundle-id';
    const appName = 'test-app-with-special-chars!@#';

    exportBundleIdToFile(bundleId, appName, false);

    expect(fs.readFileSync(path.resolve(process.cwd(), '.env.TEST_APP_WITH_SPECIAL_CHARS'), 'utf8')).toBe(`FARO_BUNDLE_ID_TEST_APP_WITH_SPECIAL_CHARS=${bundleId}`);
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

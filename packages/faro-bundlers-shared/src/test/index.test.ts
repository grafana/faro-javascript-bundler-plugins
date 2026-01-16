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
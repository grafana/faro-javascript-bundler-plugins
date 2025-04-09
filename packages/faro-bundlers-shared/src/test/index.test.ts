import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import {
  faroBundleIdSnippet,
  randomString,
  shouldProcessFile,
  exportBundleIdToFile,
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
});
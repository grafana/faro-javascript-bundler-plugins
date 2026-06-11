import { describe, expect, test, afterEach, jest } from '@jest/globals';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  resolveBundleId,
  resolveRnProjectRoot,
  validateAndroidBundleId,
} from '../resolveBundleId';

describe('resolveBundleId Android Gradle', () => {
  const prevBundleId = process.env.FARO_BUNDLE_ID;
  const prevPlatform = process.env.FARO_PLATFORM;

  afterEach(() => {
    if (prevBundleId === undefined) {
      delete process.env.FARO_BUNDLE_ID;
    } else {
      process.env.FARO_BUNDLE_ID = prevBundleId;
    }
    if (prevPlatform === undefined) {
      delete process.env.FARO_PLATFORM;
    } else {
      process.env.FARO_PLATFORM = prevPlatform;
    }
  });

  test('resolveRnProjectRoot prefers Metro bundleOptions.projectRoot', () => {
    const root = resolveRnProjectRoot({ projectRoot: '/from-metro' });
    expect(root).toBe('/from-metro');
  });

  test('resolveRnProjectRoot walks up when cwd is android/', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'faro-metro-root-'));
    fs.writeFileSync(path.join(root, 'metro.config.js'), 'module.exports = {};\n');
    const androidDir = path.join(root, 'android');
    fs.mkdirSync(androidDir);
    const cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(androidDir);
    try {
      expect(resolveRnProjectRoot()).toBe(root);
    } finally {
      cwdSpy.mockRestore();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('validateAndroidBundleId accepts encoded triple', () => {
    expect(validateAndroidBundleId('com.example@42@1.0')).toBe(true);
    expect(validateAndroidBundleId('git-sha-only')).toBe(false);
  });

  test('reads bundle id from Gradle output file', () => {
    delete process.env.FARO_BUNDLE_ID;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'faro-metro-'));
    const fileDir = path.join(root, 'android', 'app', 'build', 'faro');
    fs.mkdirSync(fileDir, { recursive: true });
    fs.writeFileSync(path.join(fileDir, 'bundle-id-release.txt'), 'com.demo@7@2.1.0\n');

    const id = resolveBundleId({ androidModule: 'app' }, false, false, { projectRoot: root });

    expect(id).toBe('com.demo@7@2.1.0');
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('skips Gradle resolution on iOS platform (auto-detect)', () => {
    delete process.env.FARO_BUNDLE_ID;
    process.env.FARO_PLATFORM = 'ios';
    const id = resolveBundleId({}, false, true);
    expect(id).toMatch(/^dev-/);
  });

  test('auto-detect iOS does not enforce Android bundle id format on FARO_BUNDLE_ID', () => {
    process.env.FARO_PLATFORM = 'ios';
    process.env.FARO_BUNDLE_ID = 'git-sha-only';
    const id = resolveBundleId({}, false, false);
    expect(id).toBe('git-sha-only');
  });

  test('throws when androidModule contains path traversal characters', () => {
    delete process.env.FARO_BUNDLE_ID;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'faro-metro-'));
    
    expect(() => {
      resolveBundleId({ androidModule: '../evil' }, false, false, { projectRoot: root });
    }).toThrow('Invalid androidModule');
    
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('throws when androidModule contains special characters', () => {
    delete process.env.FARO_BUNDLE_ID;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'faro-metro-'));
    
    expect(() => {
      resolveBundleId({ androidModule: 'app; rm -rf /' }, false, false, { projectRoot: root });
    }).toThrow('Invalid androidModule');
    
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('accepts valid androidModule with hyphens and underscores', () => {
    delete process.env.FARO_BUNDLE_ID;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'faro-metro-'));
    const fileDir = path.join(root, 'android', 'my-app_module', 'build', 'faro');
    fs.mkdirSync(fileDir, { recursive: true });
    fs.writeFileSync(path.join(fileDir, 'bundle-id-release.txt'), 'com.test@1@1.0\n');

    const id = resolveBundleId({ androidModule: 'my-app_module' }, false, false, { projectRoot: root });

    expect(id).toBe('com.test@1@1.0');
    fs.rmSync(root, { recursive: true, force: true });
  });
});

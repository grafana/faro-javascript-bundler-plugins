import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { randomString, consoleInfoOrange } from '@grafana/faro-bundlers-shared';

const MAX_BUNDLE_ID_LEN = 512;

/** Matches KWL Android symbol ingest: `{applicationId}@{versionCode}@{versionName}`. */
const ANDROID_BUNDLE_ID_PATTERN = /^[^@]+@\d+@[^@]+$/;

/** Production JS bundle / symbol uploads use the release AGP variant only. */
const ANDROID_RELEASE_VARIANT = 'release';

export type ResolveBundleIdOptions = {
  bundleId?: string;
  /**
   * Android application module folder under `android/` (default `app`).
   * Only set when the RN app module is not `app` (monorepo / custom layout).
   */
  androidModule?: string;
};

function isRnProjectRoot(dir: string): boolean {
  return (
    fs.existsSync(path.join(dir, 'metro.config.js')) ||
    fs.existsSync(path.join(dir, 'metro.config.ts')) ||
    fs.existsSync(path.join(dir, 'react-native.config.js'))
  );
}

/**
 * RN project root (folder with `metro.config.js`). Metro passes this on `bundleOptions`;
 * when Gradle runs Metro with cwd `android/`, we walk up one level.
 */
export function resolveRnProjectRoot(bundleOptions?: Record<string, unknown>): string {
  const fromMetro = bundleOptions?.projectRoot;
  if (typeof fromMetro === 'string' && fromMetro.length > 0) {
    return fromMetro;
  }
  const cwd = process.cwd();
  if (isRnProjectRoot(cwd)) {
    return cwd;
  }
  if (path.basename(cwd) === 'android') {
    const parent = path.dirname(cwd);
    if (isRnProjectRoot(parent)) {
      return parent;
    }
  }
  return cwd;
}

export function normalizeBundleIdLength(id: string): string {
  if (id.length <= MAX_BUNDLE_ID_LEN) {
    return id;
  }
  return crypto.createHash('sha256').update(id, 'utf8').digest('hex').slice(0, 32);
}

export function validateAndroidBundleId(bundleId: string): boolean {
  return ANDROID_BUNDLE_ID_PATTERN.test(bundleId);
}

/** Same signals as typical `metro.config.js` (Xcode `PLATFORM_NAME`, or `FARO_PLATFORM=ios`). */
export function isIosBundleContext(): boolean {
  const platform = (process.env.FARO_PLATFORM ?? '').toLowerCase();
  if (platform === 'ios') {
    return true;
  }
  const xc = (process.env.PLATFORM_NAME ?? '').toLowerCase();
  return xc.includes('iphone') || xc.includes('ipad');
}

function bundleIdFilePath(
  projectRoot: string,
  androidModule: string,
  variant: string
): string {
  return path.join(
    projectRoot,
    'android',
    androidModule,
    'build',
    'faro',
    `bundle-id-${variant}.txt`
  );
}

function readBundleIdFile(filePath: string): string | undefined {
  try {
    if (!fs.existsSync(filePath)) {
      return undefined;
    }
    const raw = fs.readFileSync(filePath, 'utf8').trim();
    return raw || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Runs Gradle task to write bundle id file.
 * Uses execFileSync to avoid shell interpretation.
 * androidModule is validated to contain only safe characters before use.
 */
function runGradleWriteBundleId(
  projectRoot: string,
  androidModule: string,
  variant: string
): void {
  validateAndroidModule(androidModule);
  
  const androidDir = path.join(projectRoot, 'android');
  const gradlew = path.join(androidDir, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
  if (!fs.existsSync(gradlew)) {
    throw new Error(
      `[faro-metro-plugin] Android Gradle wrapper not found at ${gradlew}. ` +
        'Run from an RN project with android/, or build via ./gradlew assembleRelease first.'
    );
  }
  const variantCap = variant.replace(/^\w/, (c) => c.toUpperCase());
  const task = `:${androidModule}:faroWriteBundleId${variantCap}`;
  execFileSync(gradlew, [task, '-q'], {
    cwd: androidDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });
}

function resolveFromAndroidGradle(
  options: ResolveBundleIdOptions,
  bundleOptions?: Record<string, unknown>
): string | undefined {
  const projectRoot = resolveRnProjectRoot(bundleOptions);
  const androidModule = options.androidModule ?? 'app';
  validateAndroidModule(androidModule);
  const filePath = bundleIdFilePath(projectRoot, androidModule, ANDROID_RELEASE_VARIANT);

  let id = readBundleIdFile(filePath);
  if (id && validateAndroidBundleId(id)) {
    return normalizeBundleIdLength(id);
  }

  try {
    runGradleWriteBundleId(projectRoot, androidModule, ANDROID_RELEASE_VARIANT);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `[faro-metro-plugin] Failed to resolve Android Faro bundle id via Gradle (${taskLabel(androidModule, ANDROID_RELEASE_VARIANT)}). ${message}`
    );
  }

  id = readBundleIdFile(filePath);
  if (!id || !validateAndroidBundleId(id)) {
    throw new Error(
      `[faro-metro-plugin] Invalid or missing bundle id at ${filePath}. ` +
        'Apply the Faro Gradle plugin (com.grafana.faro) and ensure release variant version fields are set.'
    );
  }
  return normalizeBundleIdLength(id);
}

function taskLabel(androidModule: string, variant: string): string {
  const variantCap = variant.replace(/^\w/, (c) => c.toUpperCase());
  return `:${androidModule}:faroWriteBundleId${variantCap}`;
}

function validateAndroidModule(androidModule: string): void {
  if (!/^[a-zA-Z0-9_-]+$/.test(androidModule)) {
    throw new Error(
      `[faro-metro-plugin] Invalid androidModule "${androidModule}". ` +
        'Must contain only alphanumeric characters, hyphens, and underscores.'
    );
  }
  if (androidModule.includes('..') || androidModule.includes('/') || androidModule.includes('\\')) {
    throw new Error(
      `[faro-metro-plugin] Invalid androidModule "${androidModule}". ` +
        'Path traversal characters are not allowed.'
    );
  }
}

export function resolveBundleId(
  options: ResolveBundleIdOptions | string | undefined,
  bundleDev: boolean,
  skipUpload: boolean,
  bundleOptions?: Record<string, unknown>
): string {
  const opts: ResolveBundleIdOptions =
    typeof options === 'string' ? { bundleId: options } : (options ?? {});

  const explicit = opts.bundleId ?? process.env.FARO_BUNDLE_ID;
  if (explicit) {
    const normalized = normalizeBundleIdLength(explicit.trim());
    if (!isIosBundleContext() && !bundleDev && !skipUpload && !validateAndroidBundleId(normalized)) {
      throw new Error(
        `[faro-metro-plugin] bundle id "${explicit}" is not a valid Android release identity ` +
          '(expected applicationId@versionCode@versionName). Remove FARO_BUNDLE_ID from CI and use the Faro Gradle plugin.'
      );
    }
    return normalized;
  }

  if (bundleDev || skipUpload) {
    return normalizeBundleIdLength(`dev-${randomString(6)}`);
  }

  if (!isIosBundleContext()) {
    const fromGradle = resolveFromAndroidGradle(opts, bundleOptions);
    if (fromGradle) {
      return fromGradle;
    }
  }

  consoleInfoOrange(
    'FARO_BUNDLE_ID is not set; using an ephemeral id for this build. Set FARO_BUNDLE_ID so uploads match meta.app.bundleId.'
  );
  return normalizeBundleIdLength(String(Date.now()) + randomString(5));
}

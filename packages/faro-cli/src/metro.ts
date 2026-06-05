import fs from 'fs';
import path from 'path';

import {
  consoleInfoOrange,
  ensureSourceMapFileProperty,
  isLocalEndpoint,
  THIRTY_MB_IN_BYTES,
} from '@grafana/faro-bundlers-shared';

import { uploadCompressedSourceMaps, uploadSourceMap } from './index';

/**
 * Options for `faro-cli metro upload`.
 *
 * Connection settings (endpoint, appId, stackId, apiKey) and bundleId can
 * each come from a CLI flag or the matching env var:
 *
 *   - --endpoint   / FARO_SOURCEMAP_ENDPOINT
 *   - --app-id     / FARO_SOURCEMAP_APP_ID
 *   - --stack-id   / FARO_SOURCEMAP_STACK_ID
 *   - --api-key    / FARO_SOURCEMAP_API_KEY
 *   - --bundle-id  / FARO_BUNDLE_ID
 *
 * Resolution is "first non-empty wins": CLI flag > env var. The path to
 * the source map (`--map <path>`) is required; there is no env fallback
 * or autodetect — the caller picks the file.
 */
export interface MetroUploadOptions {
  /** Path to the source map file to upload. Required. */
  map: string;
  endpoint?: string;
  appId?: string;
  stackId?: string;
  apiKey?: string;
  bundleId?: string;
  /** Defaults to true (gzipped tarball upload). `--no-gzip` flips it to a single-file POST. */
  gzip: boolean;
  verbose: boolean;
  dryRun: boolean;
  maxUploadSize?: number;
  proxy?: string;
  proxyUser?: string;
}

const trimmedString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;

const firstNonEmpty = (...values: Array<string | undefined>): string => {
  for (const value of values) {
    const trimmed = trimmedString(value);
    if (trimmed) return trimmed;
  }
  return '';
};

export interface ValidateMapResult {
  ok: boolean;
  /** 0 ok, 2 fatal config/parse, 3 v3 map with empty sources. */
  exitCode: 0 | 2 | 3;
  reason?: string;
  version?: number;
  sourcesCount?: number;
}

/**
 * Validates a source map: file exists, parses as JSON, is v3, and has a
 * non-empty `sources` array. The empty-sources case gets its own exit
 * code (3) so callers can distinguish "structurally valid but useless"
 * from "wrong file or unparseable".
 */
export const validateSourceMap = (mapPath: string): ValidateMapResult => {
  if (!fs.existsSync(mapPath)) {
    return {
      ok: false,
      exitCode: 2,
      reason: `Source map not found: ${mapPath}`,
    };
  }

  let parsed: { version?: unknown; sources?: unknown };
  try {
    parsed = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      exitCode: 2,
      reason: `Failed to parse map ${mapPath}: ${message}`,
    };
  }

  if (parsed.version !== 3) {
    return {
      ok: false,
      exitCode: 2,
      reason: `Map ${mapPath} is not a v3 source map (got version=${String(parsed.version)}).`,
      version: typeof parsed.version === 'number' ? parsed.version : undefined,
    };
  }

  if (!Array.isArray(parsed.sources) || parsed.sources.length === 0) {
    return {
      ok: false,
      exitCode: 3,
      reason: `Map ${mapPath} has no sources — nothing to symbolicate against.`,
      version: 3,
      sourcesCount: 0,
    };
  }

  return {
    ok: true,
    exitCode: 0,
    version: 3,
    sourcesCount: parsed.sources.length,
  };
};

/**
 * Implementation of `faro-cli metro upload`. Returns the process exit code
 * rather than calling process.exit so the function stays unit-testable; the
 * Commander action calls process.exit(code) when non-zero.
 */
export const runMetroUpload = async (opts: MetroUploadOptions): Promise<number> => {
  const endpoint = firstNonEmpty(opts.endpoint, process.env.FARO_SOURCEMAP_ENDPOINT);
  const appId = firstNonEmpty(opts.appId, process.env.FARO_SOURCEMAP_APP_ID);
  const stackId = firstNonEmpty(opts.stackId, process.env.FARO_SOURCEMAP_STACK_ID);
  const apiKey = firstNonEmpty(opts.apiKey, process.env.FARO_SOURCEMAP_API_KEY);
  const bundleId = firstNonEmpty(opts.bundleId, process.env.FARO_BUNDLE_ID);

  const missing: string[] = [];
  if (!endpoint) missing.push('endpoint (--endpoint or FARO_SOURCEMAP_ENDPOINT)');
  if (!appId) missing.push('appId (--app-id or FARO_SOURCEMAP_APP_ID)');
  if (!stackId) missing.push('stackId (--stack-id or FARO_SOURCEMAP_STACK_ID)');
  if (!apiKey) missing.push('apiKey (--api-key or FARO_SOURCEMAP_API_KEY)');
  if (!bundleId) missing.push('bundleId (--bundle-id or FARO_BUNDLE_ID)');
  if (missing.length > 0) {
    process.stderr.write(`Missing required settings:\n  - ${missing.join('\n  - ')}\n`);
    return 2;
  }

  const mapPath = path.resolve(opts.map);
  const validation = validateSourceMap(mapPath);
  if (!validation.ok) {
    process.stderr.write(`${validation.reason ?? 'Validation failed.'}\n`);
    return validation.exitCode;
  }

  ensureSourceMapFileProperty(mapPath, opts.verbose);

  const stats = fs.statSync(mapPath);
  const maxSize = opts.maxUploadSize && opts.maxUploadSize > 0 ? opts.maxUploadSize : THIRTY_MB_IN_BYTES;
  if (stats.size > maxSize) {
    process.stderr.write(
      `Map ${mapPath} is ${stats.size} bytes (> ${maxSize} byte limit). Aborting upload.\n`
    );
    return 2;
  }

  const normalizedEndpoint = endpoint.replace(/\/$/, '');
  const sourcemapEndpoint = `${normalizedEndpoint}/app/${appId}/sourcemaps/${bundleId}`;
  const summary =
    `\nfaro-cli metro upload\n` +
    `  map        : ${mapPath}\n` +
    `  size       : ${stats.size} bytes\n` +
    `  sources    : ${validation.sourcesCount}\n` +
    `  endpoint   : ${sourcemapEndpoint}\n` +
    `  bundleId   : ${bundleId}\n` +
    `  gzip       : ${opts.gzip ? 'yes' : 'no'}\n`;
  process.stdout.write(summary);

  if (opts.dryRun) {
    process.stdout.write('\nDry run — not uploading.\n');
    return 0;
  }

  if (opts.verbose) {
    consoleInfoOrange(`Uploading source map ${mapPath}.`);
  }

  const ok = opts.gzip
    ? await uploadCompressedSourceMaps({
        endpoint: normalizedEndpoint,
        appId,
        apiKey,
        stackId,
        bundleId,
        outputPath: path.dirname(mapPath),
        files: [mapPath],
        keepSourcemaps: true,
        verbose: opts.verbose,
        maxUploadSize: opts.maxUploadSize,
        proxy: opts.proxy,
        proxyUser: opts.proxyUser,
      })
    : await uploadSourceMap({
        endpoint: normalizedEndpoint,
        appId,
        apiKey,
        stackId,
        bundleId,
        filePath: mapPath,
        filename: path.basename(mapPath),
        keepSourcemaps: true,
        verbose: opts.verbose,
        maxUploadSize: opts.maxUploadSize,
        proxy: opts.proxy,
        proxyUser: opts.proxyUser,
      });

  if (!ok) {
    const hints = [
      'Verify endpoint, app id, stack id, and API key (CLI flags or FARO_SOURCEMAP_* env vars).',
    ];
    if (isLocalEndpoint(normalizedEndpoint)) {
      hints.push('Local stack: confirm the API key matches your Frontend Observability source map upload token.');
    }
    hints.push('Re-run with --verbose to see the HTTP status and response body.');

    process.stderr.write(
      `\n[Faro] ERROR: Metro composed source map upload failed.\n` +
        `  endpoint : ${sourcemapEndpoint}\n` +
        `  bundleId : ${bundleId}\n` +
        hints.map((line) => `  ${line}\n`).join('')
    );
    return 1;
  }

  process.stdout.write('\nUpload complete.\n');
  return 0;
};

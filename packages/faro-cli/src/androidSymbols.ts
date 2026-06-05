import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

import { consoleInfoOrange, isLocalEndpoint } from '@grafana/faro-bundlers-shared';

/**
 * Options for `faro-cli android upload`.
 *
 * Connection settings (endpoint, appId, stackId, apiKey) can each come from a
 * CLI flag or the matching env var (first non-empty wins: flag > env):
 *
 *   - --endpoint   / FARO_SOURCEMAP_ENDPOINT
 *   - --app-id     / FARO_SOURCEMAP_APP_ID
 *   - --stack-id   / FARO_SOURCEMAP_STACK_ID
 *   - --api-key    / FARO_SOURCEMAP_API_KEY
 *
 * Build identity (the lookup key the collector uses to retrace crashes) can
 * likewise come from a flag or env:
 *
 *   - --application-id / FARO_ANDROID_APPLICATION_ID
 *   - --version-code   / FARO_ANDROID_VERSION_CODE
 *   - --version-name   / FARO_ANDROID_VERSION_NAME
 *
 * At least one of `--mapping` (R8/ProGuard mapping.txt) or `--native-symbols`
 * (native-debug-symbols.zip) must be provided.
 */
export interface AndroidSymbolsUploadOptions {
  endpoint?: string;
  appId?: string;
  stackId?: string;
  apiKey?: string;
  applicationId?: string;
  versionCode?: string;
  versionName?: string;
  /** Path to the R8/ProGuard mapping.txt. */
  mapping?: string;
  /** Path to the native-debug-symbols.zip. */
  nativeSymbols?: string;
  verbose: boolean;
  dryRun: boolean;
  proxy?: string;
  proxyUser?: string;
}

const trimmedString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;

const firstNonEmpty = (...values: Array<string | undefined>): string => {
  for (const value of values) {
    const trimmed = trimmedString(value);
    if (trimmed) {
      return trimmed;
    }
  }
  return '';
};

interface ResolvedConfig {
  endpoint: string;
  appId: string;
  stackId: string;
  apiKey: string;
  bundleId: string;
  mappingPath?: string;
  nativeSymbolsPath?: string;
}

/** Encoded Android symbols bundle id: `{applicationId}@{versionCode}@{versionName}`. */
export function formatAndroidSymbolsBundleId(
  applicationId: string,
  versionCode: string,
  versionName: string
): string {
  return `${applicationId}@${versionCode}@${versionName}`;
}

interface ResolveResult {
  config?: ResolvedConfig;
  /** 0 ok, 2 fatal config/validation. */
  exitCode: 0 | 2;
  reason?: string;
}

function resolveConfig(opts: AndroidSymbolsUploadOptions): ResolveResult {
  const endpoint = firstNonEmpty(opts.endpoint, process.env.FARO_SOURCEMAP_ENDPOINT);
  const appId = firstNonEmpty(opts.appId, process.env.FARO_SOURCEMAP_APP_ID);
  const stackId = firstNonEmpty(opts.stackId, process.env.FARO_SOURCEMAP_STACK_ID);
  const apiKey = firstNonEmpty(opts.apiKey, process.env.FARO_SOURCEMAP_API_KEY);
  const applicationId = firstNonEmpty(opts.applicationId, process.env.FARO_ANDROID_APPLICATION_ID);
  const versionCode = firstNonEmpty(opts.versionCode, process.env.FARO_ANDROID_VERSION_CODE);
  const versionName = firstNonEmpty(opts.versionName, process.env.FARO_ANDROID_VERSION_NAME);

  const missing: string[] = [];
  if (!endpoint) missing.push('endpoint (--endpoint or FARO_SOURCEMAP_ENDPOINT)');
  if (!appId) missing.push('appId (--app-id or FARO_SOURCEMAP_APP_ID)');
  if (!stackId) missing.push('stackId (--stack-id or FARO_SOURCEMAP_STACK_ID)');
  if (!apiKey) missing.push('apiKey (--api-key or FARO_SOURCEMAP_API_KEY)');
  if (!applicationId) missing.push('applicationId (--application-id or FARO_ANDROID_APPLICATION_ID)');
  if (!versionCode) missing.push('versionCode (--version-code or FARO_ANDROID_VERSION_CODE)');
  if (!versionName) missing.push('versionName (--version-name or FARO_ANDROID_VERSION_NAME)');

  if (missing.length > 0) {
    return { exitCode: 2, reason: `Missing required settings:\n  - ${missing.join('\n  - ')}` };
  }

  const mappingPath = trimmedString(opts.mapping);
  const nativeSymbolsPath = trimmedString(opts.nativeSymbols);
  if (!mappingPath && !nativeSymbolsPath) {
    return {
      exitCode: 2,
      reason: 'Provide at least one of --mapping <mapping.txt> or --native-symbols <native-debug-symbols.zip>.',
    };
  }

  const resolvedMapping = mappingPath ? path.resolve(mappingPath) : undefined;
  if (resolvedMapping && !fs.existsSync(resolvedMapping)) {
    return { exitCode: 2, reason: `mapping file not found: ${resolvedMapping}` };
  }

  const resolvedNative = nativeSymbolsPath ? path.resolve(nativeSymbolsPath) : undefined;
  if (resolvedNative && !fs.existsSync(resolvedNative)) {
    return { exitCode: 2, reason: `native-symbols file not found: ${resolvedNative}` };
  }

  return {
    exitCode: 0,
    config: {
      endpoint,
      appId,
      stackId,
      apiKey,
      bundleId: formatAndroidSymbolsBundleId(applicationId, versionCode, versionName),
      mappingPath: resolvedMapping,
      nativeSymbolsPath: resolvedNative,
    },
  };
}

/**
 * Builds the multipart `curl` command used to POST Android symbol artifacts.
 * Exported for testing. `curl -F` sets `Content-Type: multipart/form-data`
 * automatically, so no explicit content-type header is added.
 */
export function buildAndroidSymbolsCurlCommand(config: ResolvedConfig, opts: AndroidSymbolsUploadOptions): string {
  const normalizedEndpoint = config.endpoint.replace(/\/$/, '');
  const url = `${normalizedEndpoint}/app/${config.appId}/symbols/android/${encodeURIComponent(config.bundleId)}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.stackId}:${config.apiKey}`,
  };
  // Local dev (noop auth) derives the stack from X-Scope-OrgID instead of the token.
  if (isLocalEndpoint(url)) {
    headers['X-Scope-OrgID'] = config.stackId;
  }

  const headerArgs = Object.entries(headers)
    .map(([key, value]) => `-H "${key}: ${value}"`)
    .join(' ');

  const formArgs: string[] = [];
  if (config.mappingPath) {
    formArgs.push(`-F "mapping=@${config.mappingPath};type=text/plain"`);
  }
  if (config.nativeSymbolsPath) {
    formArgs.push(`-F "native-symbols=@${config.nativeSymbolsPath};type=application/zip"`);
  }

  const proxyArg = opts.proxy ? `--proxy "${opts.proxy}"` : '';
  const proxyUserArg = opts.proxyUser ? `--proxy-user "${opts.proxyUser}"` : '';

  // -w prints the HTTP status code on its own trailing line so we can detect failures.
  return `curl -s -w "\\n%{http_code}" -X POST ${proxyArg} ${proxyUserArg} "${url}" ${headerArgs} ${formArgs.join(' ')}`
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Resolves config, then uploads the Android symbol artifacts via `curl`.
 *
 * Returns a numeric exit code (so it is easy to test and the commander action
 * can `process.exit` on non-zero):
 *   - 0 success
 *   - 1 upload failure (non-2xx response or curl error)
 *   - 2 fatal config/validation error
 */
export const runAndroidSymbolsUpload = async (opts: AndroidSymbolsUploadOptions): Promise<number> => {
  const resolved = resolveConfig(opts);
  if (!resolved.config) {
    process.stderr.write(`${resolved.reason ?? 'Validation failed.'}\n`);
    return resolved.exitCode;
  }

  const config = resolved.config;
  const command = buildAndroidSymbolsCurlCommand(config, opts);
  const targetUrl = `${config.endpoint.replace(/\/$/, '')}/app/${config.appId}/symbols/android/${encodeURIComponent(config.bundleId)}`;

  const artifactList = [
    config.mappingPath ? `mapping=${path.basename(config.mappingPath)}` : null,
    config.nativeSymbolsPath ? `native-symbols=${path.basename(config.nativeSymbolsPath)}` : null,
  ]
    .filter(Boolean)
    .join(', ');

  if (opts.dryRun) {
    process.stdout.write(
      `[dry-run] would upload Android symbols (${artifactList}) for ${config.bundleId} to ${targetUrl}\n`
    );
    opts.verbose && process.stdout.write(`[dry-run] ${command}\n`);
    return 0;
  }

  opts.verbose &&
    consoleInfoOrange(
      `Uploading Android symbols (${artifactList}) for ${config.bundleId} to ${targetUrl}`
    );

  try {
    const result = execSync(command, { encoding: 'utf8' });
    const lines = result.trim().split('\n');
    const statusCode = Number.parseInt(lines[lines.length - 1] ?? '', 10);
    const body = lines.slice(0, -1).join('\n').trim();

    if (Number.isNaN(statusCode) || statusCode < 200 || statusCode >= 300) {
      process.stderr.write(`Android symbols upload failed (HTTP ${lines[lines.length - 1] ?? '?'}).\n`);
      if (body) {
        process.stderr.write(`${body}\n`);
      }
      return 1;
    }

    process.stdout.write(`Upload complete (HTTP ${statusCode}).\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`Error executing curl command: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
};

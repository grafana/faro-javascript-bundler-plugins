import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { consoleInfoOrange, isLocalEndpoint } from '@grafana/faro-bundlers-shared';

import { AbiZipArtifact, packNativeSymbolsByAbi } from './nativeSymbolsByAbi';

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
 * (native-debug-symbols.zip) must be provided. When native symbols are provided,
 * the CLI splits the AGP zip by ABI and uploads one POST per ABI (each under the
 * HTTP body size limit).
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

function redactCredential(value: string): string {
  if (value.length <= 8) {
    return '****';
  }
  return value.substring(0, 4) + '****';
}

function redactBearerToken(stackId: string, apiKey: string): string {
  return `Bearer ${redactCredential(stackId)}:${redactCredential(apiKey)}`;
}

function buildVerboseCurlCommand(command: string, config: ResolvedConfig): string {
  let redacted = command;
  const rawBearerToken = `Bearer ${config.stackId}:${config.apiKey}`;
  redacted = redacted.split(rawBearerToken).join(redactBearerToken(config.stackId, config.apiKey));
  if (command.includes('--proxy-user')) {
    redacted = redacted.replace(/--proxy-user "([^"]+)"/g, '--proxy-user "****"');
  }
  return redacted;
}

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
function formatAndroidSymbolsBundleId(
  applicationId: string,
  versionCode: string,
  versionName: string
): string {
  if (applicationId.includes('@')) {
    throw new Error(`applicationId cannot contain '@': ${applicationId}`);
  }
  if (versionName.includes('@')) {
    throw new Error(`versionName cannot contain '@': ${versionName}`);
  }
  if (!/^\d+$/.test(versionCode)) {
    throw new Error(`versionCode must be an integer: ${versionCode}`);
  }
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

  let bundleId: string;
  try {
    bundleId = formatAndroidSymbolsBundleId(applicationId, versionCode, versionName);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { exitCode: 2, reason: message };
  }

  return {
    exitCode: 0,
    config: {
      endpoint,
      appId,
      stackId,
      apiKey,
      bundleId,
      mappingPath: resolvedMapping,
      nativeSymbolsPath: resolvedNative,
    },
  };
}

export interface AndroidSymbolsUploadRequest {
  label: string;
  curlCommand: string;
  localBytes: number;
}

/**
 * Builds curl commands for mapping (optional) and each ABI zip (when native symbols provided).
 * Exported for testing.
 */
export function buildAndroidSymbolsUploadRequests(
  config: ResolvedConfig,
  opts: AndroidSymbolsUploadOptions,
  abiArtifacts: AbiZipArtifact[] = []
): AndroidSymbolsUploadRequest[] {
  const normalizedEndpoint = config.endpoint.replace(/\/$/, '');
  
  // Validate URL to prevent command injection
  if (normalizedEndpoint.includes('"') || normalizedEndpoint.includes('`') || normalizedEndpoint.includes('$')) {
    throw new Error('Invalid endpoint URL: contains shell metacharacters');
  }
  
  const url = `${normalizedEndpoint}/app/${encodeURIComponent(config.appId)}/symbols/android/${encodeURIComponent(config.bundleId)}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.stackId}:${config.apiKey}`,
  };
  if (isLocalEndpoint(url)) {
    headers['X-Scope-OrgID'] = config.stackId;
  }

  const headerArgs = Object.entries(headers)
    .map(([key, value]) => `-H "${key}: ${value}"`)
    .join(' ');

  // Validate proxy and credentials don't contain shell metacharacters (use safer string methods instead of regex to avoid ReDoS)
  const shellMetachars = ['"', '`', '$'];
  if (opts.proxy && shellMetachars.some(char => opts.proxy!.includes(char))) {
    throw new Error('Invalid proxy URL: contains shell metacharacters');
  }
  if (opts.proxyUser && shellMetachars.some(char => opts.proxyUser!.includes(char))) {
    throw new Error('Invalid proxy credentials: contains shell metacharacters');
  }
  const proxyArg = opts.proxy ? `--proxy "${opts.proxy}"` : '';
  const proxyUserArg = opts.proxyUser ? `--proxy-user "${opts.proxyUser}"` : '';
  const baseCurl = `curl -s -w "\\n%{http_code}" -X POST ${proxyArg} ${proxyUserArg}`.replace(/\s+/g, ' ').trim();

  const requests: AndroidSymbolsUploadRequest[] = [];

  if (config.mappingPath) {
    const mappingBytes = fs.statSync(config.mappingPath).size;
    requests.push({
      label: 'mapping',
      localBytes: mappingBytes,
      curlCommand: `${baseCurl} "${url}" ${headerArgs} -F "mapping=@\\"${config.mappingPath}\\";type=text/plain"`,
    });
  }

  for (const artifact of abiArtifacts) {
    requests.push({
      label: `native-symbols (${artifact.abi})`,
      localBytes: artifact.bytes,
      curlCommand:
        `${baseCurl} "${url}" ${headerArgs} -F "abi=${artifact.abi}" ` +
        `-F "native-symbols=@\\"${artifact.zipPath}\\";type=application/zip"`,
    });
  }

  return requests;
}

/**
 * Executes curl command and parses HTTP status from output.
 * Uses execFileSync to avoid shell interpretation and prevent command injection.
 */
function runCurl(command: string): { statusCode: number; body: string } {
  // Parse curl command string into arguments array for execFileSync
  // The command format is: curl -s -w "\n%{http_code}" ... [args]
  const args: string[] = [];
  
  // Extract arguments from command string (skip 'curl' prefix if present)
  const cmdString = command.startsWith('curl ') ? command.substring(5) : command;
  
  // Simple argument parser that handles quoted strings
  let current = '';
  let inQuote = false;
  let escapeNext = false;
  
  for (let i = 0; i < cmdString.length; i++) {
    const char = cmdString[i];
    
    if (escapeNext) {
      current += char;
      escapeNext = false;
      continue;
    }
    
    if (char === '\\') {
      escapeNext = true;
      continue;
    }
    
    if (char === '"') {
      inQuote = !inQuote;
      continue;
    }
    
    if (char === ' ' && !inQuote) {
      if (current) {
        args.push(current);
        current = '';
      }
      continue;
    }
    
    current += char;
  }
  
  if (current) {
    args.push(current);
  }
  
  const result = execFileSync('curl', args, { encoding: 'utf8' });
  const lines = result.trim().split('\n');
  const statusCode = Number.parseInt(lines[lines.length - 1] ?? '', 10);
  const body = lines.slice(0, -1).join('\n').trim();
  return { statusCode, body };
}

/**
 * Resolves config, splits native symbols by ABI, then uploads via sequential curl POSTs.
 */
export const runAndroidSymbolsUpload = async (opts: AndroidSymbolsUploadOptions): Promise<number> => {
  const resolved = resolveConfig(opts);
  if (!resolved.config) {
    process.stderr.write(`${resolved.reason ?? 'Validation failed.'}\n`);
    return resolved.exitCode;
  }

  const config = resolved.config;
  const targetUrl = `${config.endpoint.replace(/\/$/, '')}/app/${config.appId}/symbols/android/${encodeURIComponent(config.bundleId)}`;

  let abiArtifacts: AbiZipArtifact[] = [];
  let tempDir: string | undefined;
  try {
    if (config.nativeSymbolsPath) {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'faro-abi-'));
      abiArtifacts = packNativeSymbolsByAbi(config.nativeSymbolsPath, tempDir);
    }
  } catch (err) {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    throw err;
  }

  const requests = buildAndroidSymbolsUploadRequests(config, opts, abiArtifacts);

  if (opts.dryRun) {
    for (const req of requests) {
      process.stdout.write(
        `[dry-run] would upload ${req.label} (${req.localBytes} bytes) for ${config.bundleId} to ${targetUrl}\n`
      );
      if (opts.verbose) {
        const redacted = buildVerboseCurlCommand(req.curlCommand, config);
        process.stdout.write(`[dry-run] ${redacted}\n`);
      }
    }
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    return 0;
  }

  opts.verbose &&
    consoleInfoOrange(`Uploading Android symbols (${requests.length} POSTs) for ${config.bundleId} to ${targetUrl}`);

  try {
    for (const req of requests) {
      opts.verbose && process.stdout.write(`[Faro] uploading ${req.label} (${req.localBytes} bytes)\n`);
      const { statusCode, body } = runCurl(req.curlCommand);
      if (Number.isNaN(statusCode) || statusCode < 200 || statusCode >= 300) {
        process.stderr.write(`Android symbols upload failed for ${req.label} (HTTP ${statusCode}).\n`);
        if (body) {
          process.stderr.write(`${body}\n`);
        }
        return 1;
      }
      process.stdout.write(`Uploaded ${req.label} (${req.localBytes} bytes, HTTP ${statusCode}).\n`);
    }

    process.stdout.write(`Upload complete (${requests.length} POSTs).\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`Error executing curl command: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  } finally {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
};

import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi, type MockedFunction, type MockInstance } from 'vitest';
import { FormData } from 'undici';

import { buildTestAgpZip } from './helpers/buildTestAgpZip';

vi.doMock('child_process', () => ({
  execSync: vi.fn(() => { throw new Error('git not available'); }),
}));
vi.doMock('../upload', () => ({
  post: vi.fn(),
}));

const { post } = await import('../upload');
const { buildAndroidSymbolsUploadRequests, runAndroidSymbolsUpload } = await import('../androidSymbols');

const mockedPost = post as MockedFunction<typeof import('../upload').post>;

const baseConnection = {
  endpoint: 'https://e.test/',
  appId: 'aid',
  stackId: 'sid',
  apiKey: 'secret',
  applicationId: 'com.grafana.quickpizza',
  versionCode: '42',
  versionName: '1.0',
};

describe('runAndroidSymbolsUpload', () => {
  let tempDir: string;
  let mappingPath: string;
  let stdoutSpy: MockInstance;
  let stderrSpy: MockInstance;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'faro-android-'));
    mappingPath = path.join(tempDir, 'mapping.txt');
    fs.writeFileSync(mappingPath, 'com.example.Foo -> a:\n');
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    mockedPost.mockReset();
    // Mock successful upload response by default
    mockedPost.mockResolvedValue({ status: 201, body: '{"uploaded": true}' });
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns 2 when required settings are missing', async () => {
    const code = await runAndroidSymbolsUpload({
      mapping: mappingPath,
      verbose: false,
      dryRun: false,
    });

    expect(code).toBe(2);
    expect(mockedPost).not.toHaveBeenCalled();
    const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(stderr).toMatch(/Missing required settings/);
  });

  it('returns 2 when neither mapping nor native-symbols is provided', async () => {
    const code = await runAndroidSymbolsUpload({ ...baseConnection, verbose: false, dryRun: false });

    expect(code).toBe(2);
    const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(stderr).toMatch(/at least one of --mapping/i);
  });

  it('returns 2 when applicationId contains @ character', async () => {
    const code = await runAndroidSymbolsUpload({
      ...baseConnection,
      applicationId: 'com.evil@inject',
      mapping: mappingPath,
      verbose: false,
      dryRun: false,
    });

    expect(code).toBe(2);
    const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(stderr).toMatch(/cannot contain '@'/);
  });

  it('returns 2 when versionName contains @ character', async () => {
    const code = await runAndroidSymbolsUpload({
      ...baseConnection,
      versionName: '1.0@evil',
      mapping: mappingPath,
      verbose: false,
      dryRun: false,
    });

    expect(code).toBe(2);
    const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(stderr).toMatch(/cannot contain '@'/);
  });

  it('returns 2 when versionCode is not an integer', async () => {
    const code = await runAndroidSymbolsUpload({
      ...baseConnection,
      versionCode: '42.5',
      mapping: mappingPath,
      verbose: false,
      dryRun: false,
    });

    expect(code).toBe(2);
    const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(stderr).toMatch(/must be an integer/);
  });

  it('returns 2 when the mapping file does not exist', async () => {
    const code = await runAndroidSymbolsUpload({
      ...baseConnection,
      mapping: path.join(tempDir, 'missing.txt'),
      verbose: false,
      dryRun: false,
    });

    expect(code).toBe(2);
    const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(stderr).toMatch(/mapping file not found/);
  });

  it('does not upload on a dry run', async () => {
    const code = await runAndroidSymbolsUpload({
      ...baseConnection,
      mapping: mappingPath,
      verbose: false,
      dryRun: true,
    });

    expect(code).toBe(0);
    expect(mockedPost).not.toHaveBeenCalled();
    const stdout = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(stdout).toMatch(/\[dry-run\] would upload mapping/);
  });

  it('redacts credentials in verbose dry-run output', async () => {
    const code = await runAndroidSymbolsUpload({
      ...baseConnection,
      mapping: mappingPath,
      verbose: true,
      dryRun: true,
    });

    expect(code).toBe(0);
    const stdout = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    // Credentials should be redacted
    expect(stdout).not.toContain('sid:secret');
    expect(stdout).toMatch(/Bearer.*\*\*\*\*/);
  });

  it('uploads mapping and returns 0 on a 2xx response', async () => {
    mockedPost.mockResolvedValue({ status: 201, body: '' });

    const code = await runAndroidSymbolsUpload({
      ...baseConnection,
      mapping: mappingPath,
      verbose: false,
      dryRun: false,
    });

    expect(code).toBe(0);
    expect(mockedPost).toHaveBeenCalledTimes(1);
    expect(mockedPost).toHaveBeenCalledWith(
      'https://e.test/app/aid/symbols/android/com.grafana.quickpizza%4042%401.0',
      { Authorization: 'Bearer sid:secret' },
      expect.any(FormData),
      undefined,
      undefined,
    );
    const stdout = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(stdout).toMatch(/Upload complete \(1 POSTs\)/);
  });

  it('prints warning to stderr when a 201 response includes status=warn', async () => {
    mockedExecFileSync.mockReturnValue(
      '{"status":"warn","message":"Native symbols uploaded, but 1 library was skipped because the decompressed ELF exceeded the per-library size limit: arm64-v8a/libreactnative.so (93 MiB > 64 MiB limit).","skipped_libraries":[{"abi":"arm64-v8a","name":"libreactnative.so","size_bytes":97517568,"limit_bytes":67108864,"reason":"per_library_size_limit"}]}\n201' as never
    );

    const code = await runAndroidSymbolsUpload({
      ...baseConnection,
      mapping: mappingPath,
      verbose: false,
      dryRun: false,
    });

    expect(code).toBe(0);
    const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(stderr).toContain(
      '[Faro] WARNING: Native symbols uploaded, but 1 library was skipped because the decompressed ELF exceeded the per-library size limit: arm64-v8a/libreactnative.so (93 MiB > 64 MiB limit).'
    );
  });

  it('returns 1 on a non-2xx response', async () => {
    mockedPost.mockResolvedValue({ status: 400, body: 'bad request' });

    const code = await runAndroidSymbolsUpload({
      ...baseConnection,
      mapping: mappingPath,
      verbose: false,
      dryRun: false,
    });

    expect(code).toBe(1);
    const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(stderr).toMatch(/HTTP 400/);
  });

  it('returns 1 when the request throws', async () => {
    mockedPost.mockRejectedValue(new Error('fetch failed'));

    const code = await runAndroidSymbolsUpload({
      ...baseConnection,
      mapping: mappingPath,
      verbose: false,
      dryRun: false,
    });

    expect(code).toBe(1);
  });
});

describe('buildAndroidSymbolsUploadRequests', () => {
  let localTempDir: string;
  let localMappingPath: string;

  beforeEach(() => {
    localTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'faro-android-req-'));
    localMappingPath = path.join(localTempDir, 'mapping.txt');
    fs.writeFileSync(localMappingPath, 'proguard mapping');
  });

  afterEach(() => {
    fs.rmSync(localTempDir, { recursive: true, force: true });
  });

  const config = () => ({
    ...baseConnection,
    endpoint: 'https://e.test/',
    mappingPath: localMappingPath,
    nativeSymbolsPath: undefined as string | undefined,
    bundleId: 'com.grafana.quickpizza@42@1.0',
  });

  it('builds mapping-only request with URL, auth, and mapping field', () => {
    const requests = buildAndroidSymbolsUploadRequests(config(), { verbose: false, dryRun: false }, []);
    expect(requests).toHaveLength(1);
    expect(requests[0].label).toBe('mapping');
    
    const req = requests[0];
    expect(req.url).toBe('https://e.test/app/aid/symbols/android/com.grafana.quickpizza%4042%401.0');
    expect(req.headers).toEqual({ Authorization: 'Bearer sid:secret' });
    expect(req.fields).toEqual({});
    expect(req.file).toEqual({ field: 'mapping', path: localMappingPath, type: 'text/plain' });
    
    // Check display command (for verbose output)
    const cmd = requests[0].curlCommand;
    expect(cmd).toContain('curl');
    expect(cmd).toContain('Authorization: Bearer');
  });

  it('adds X-Scope-OrgID for local endpoints', () => {
    const requests = buildAndroidSymbolsUploadRequests(
      { ...config(), endpoint: 'http://localhost:8000' },
      { verbose: false, dryRun: false },
      [],
    );
    expect(requests[0].headers['X-Scope-OrgID']).toBe('sid');
  });

  it('builds per-ABI native requests with abi form field', () => {
    const nativePath = path.join(localTempDir, 'native.zip');
    fs.writeFileSync(
      nativePath,
      buildTestAgpZip([
        ['arm64-v8a/liba.so', Buffer.alloc(8, 1)],
        ['x86_64/libb.so', Buffer.alloc(8, 2)],
      ]),
    );

    const abiArtifacts = [
      { abi: 'arm64-v8a' as const, zipPath: path.join(localTempDir, 'arm64-v8a.zip'), bytes: 100 },
      { abi: 'x86_64' as const, zipPath: path.join(localTempDir, 'x86_64.zip'), bytes: 100 },
    ];
    fs.writeFileSync(abiArtifacts[0].zipPath, Buffer.alloc(100));
    fs.writeFileSync(abiArtifacts[1].zipPath, Buffer.alloc(100));

    const requests = buildAndroidSymbolsUploadRequests(
      { ...config(), nativeSymbolsPath: nativePath },
      { verbose: false, dryRun: false },
      abiArtifacts,
    );

    expect(requests).toHaveLength(3);
    expect(requests[1].fields).toEqual({ abi: 'arm64-v8a' });
    expect(requests[1].file).toEqual({
      field: 'native-symbols',
      path: abiArtifacts[0].zipPath,
      type: 'application/zip',
    });
    expect(requests[2].fields).toEqual({ abi: 'x86_64' });
  });
});

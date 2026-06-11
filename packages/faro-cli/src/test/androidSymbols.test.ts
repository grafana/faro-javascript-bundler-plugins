import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { buildAndroidSymbolsUploadRequests, runAndroidSymbolsUpload } from '../androidSymbols';
import { buildTestAgpZip } from './helpers/buildTestAgpZip';

jest.mock('child_process', () => ({
  execSync: jest.fn(),
}));

const mockedExecSync = execSync as jest.MockedFunction<typeof execSync>;

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
  let stdoutSpy: jest.SpiedFunction<typeof process.stdout.write>;
  let stderrSpy: jest.SpiedFunction<typeof process.stderr.write>;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'faro-android-'));
    mappingPath = path.join(tempDir, 'mapping.txt');
    fs.writeFileSync(mappingPath, 'com.example.Foo -> a:\n');
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    mockedExecSync.mockReset();
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
    expect(mockedExecSync).not.toHaveBeenCalled();
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

  it('does not call curl on a dry run', async () => {
    const code = await runAndroidSymbolsUpload({
      ...baseConnection,
      mapping: mappingPath,
      verbose: false,
      dryRun: true,
    });

    expect(code).toBe(0);
    expect(mockedExecSync).not.toHaveBeenCalled();
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
    mockedExecSync.mockReturnValue('\n201' as never);

    const code = await runAndroidSymbolsUpload({
      ...baseConnection,
      mapping: mappingPath,
      verbose: false,
      dryRun: false,
    });

    expect(code).toBe(0);
    expect(mockedExecSync).toHaveBeenCalledTimes(1);
    expect(mockedExecSync).toHaveBeenCalledWith(expect.stringContaining('curl -s'), expect.any(Object));
    const stdout = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(stdout).toMatch(/Upload complete \(1 POSTs\)/);
  });

  it('returns 1 on a non-2xx response', async () => {
    mockedExecSync.mockReturnValue('bad request\n400' as never);

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

  it('returns 1 when curl throws', async () => {
    mockedExecSync.mockImplementation(() => {
      throw new Error('curl: command not found');
    });

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

  it('throws when endpoint contains shell metacharacters', () => {
    expect(() =>
      buildAndroidSymbolsUploadRequests(
        { ...config(), endpoint: 'https://e.test/`whoami`' },
        { verbose: false, dryRun: false },
        []
      )
    ).toThrow('shell metacharacters');
  });

  it('builds mapping-only request with URL, auth, and mapping field', () => {
    const requests = buildAndroidSymbolsUploadRequests(config(), { verbose: false, dryRun: false }, []);
    expect(requests).toHaveLength(1);
    expect(requests[0].label).toBe('mapping');
    const cmd = requests[0].curlCommand;
    expect(cmd).toContain('"https://e.test/app/aid/symbols/android/com.grafana.quickpizza%4042%401.0"');
    expect(cmd).toContain('-H "Authorization: Bearer sid:secret"');
    expect(cmd).toContain(`-F "mapping=@\\"${localMappingPath}\\";type=text/plain"`);
    // Remote endpoint must not leak a stack-id header.
    expect(cmd).not.toContain('X-Scope-OrgID');
  });

  it('adds X-Scope-OrgID for local endpoints', () => {
    const requests = buildAndroidSymbolsUploadRequests(
      { ...config(), endpoint: 'http://localhost:8000' },
      { verbose: false, dryRun: false },
      [],
    );
    expect(requests[0].curlCommand).toContain('-H "X-Scope-OrgID: sid"');
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
    expect(requests[1].curlCommand).toContain('-F "abi=arm64-v8a"');
    expect(requests[2].curlCommand).toContain('-F "abi=x86_64"');
  });
});

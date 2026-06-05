import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { buildAndroidSymbolsCurlCommand, runAndroidSymbolsUpload } from '../androidSymbols';

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
    expect(stdout).toMatch(/\[dry-run\] would upload Android symbols/);
  });

  it('uploads and returns 0 on a 2xx response', async () => {
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
    expect(stdout).toMatch(/Upload complete \(HTTP 201\)/);
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

describe('buildAndroidSymbolsCurlCommand', () => {
  const config = {
    ...baseConnection,
    endpoint: 'https://e.test/',
    mappingPath: '/abs/mapping.txt',
    nativeSymbolsPath: '/abs/native-debug-symbols.zip',
    bundleId: 'com.grafana.quickpizza@42@1.0',
  };

  it('builds the symbols/android URL, auth header and multipart fields', () => {
    const cmd = buildAndroidSymbolsCurlCommand(config, { verbose: false, dryRun: false });

    expect(cmd).toContain('"https://e.test/app/aid/symbols/android/com.grafana.quickpizza%4042%401.0"');
    expect(cmd).toContain('-H "Authorization: Bearer sid:secret"');
    expect(cmd).toContain('-F "mapping=@/abs/mapping.txt;type=text/plain"');
    expect(cmd).toContain('-F "native-symbols=@/abs/native-debug-symbols.zip;type=application/zip"');
    // Remote endpoint must not leak a stack-id header.
    expect(cmd).not.toContain('X-Scope-OrgID');
  });

  it('adds X-Scope-OrgID for local endpoints', () => {
    const cmd = buildAndroidSymbolsCurlCommand(
      { ...config, endpoint: 'http://localhost:8000' },
      { verbose: false, dryRun: false }
    );

    expect(cmd).toContain('-H "X-Scope-OrgID: sid"');
  });
});

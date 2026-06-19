import fs from 'fs';
import os from 'os';
import path from 'path';
import { jest } from '@jest/globals';
import { THIRTY_MB_IN_BYTES } from '@grafana/faro-bundlers-shared';

jest.mock('../index', () => ({
  uploadCompressedSourceMaps: jest.fn(),
  uploadSourceMap: jest.fn(),
}));

import * as faroIndex from '../index';
import { runMetroUpload, validateSourceMap } from '../metro';

const FARO_ENV_VARS = [
  'FARO_BUNDLE_ID',
  'FARO_SOURCEMAP_API_KEY',
  'FARO_SOURCEMAP_APP_ID',
  'FARO_SOURCEMAP_ENDPOINT',
  'FARO_SOURCEMAP_STACK_ID',
];

const stashedEnv: Record<string, string | undefined> = {};

const createTempDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'faro-cli-metro-'));

const removeTempDir = (dir: string): void => {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

const writeValidMap = (dir: string, name = 'bundle.map'): string => {
  const mapPath = path.join(dir, name);
  fs.writeFileSync(
    mapPath,
    JSON.stringify({ version: 3, sources: ['a.js', 'b.js'], mappings: '' })
  );
  return mapPath;
};

const fullConnectionOpts = {
  endpoint: 'https://faro.example.test',
  appId: 'app',
  stackId: 'stack',
  apiKey: 'key',
  bundleId: 'bundle',
};

beforeEach(() => {
  for (const key of FARO_ENV_VARS) {
    stashedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of FARO_ENV_VARS) {
    if (stashedEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = stashedEnv[key];
    }
  }
  jest.restoreAllMocks();
});

describe('validateSourceMap', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    removeTempDir(tempDir);
  });

  it('returns exit code 2 when the file is missing', () => {
    const result = validateSourceMap(path.join(tempDir, 'missing.map'));
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(2);
    expect(result.reason).toMatch(/Source map not found/);
  });

  it('returns exit code 2 on malformed JSON', () => {
    const mapPath = path.join(tempDir, 'bad.map');
    fs.writeFileSync(mapPath, '{ not json');

    const result = validateSourceMap(mapPath);
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(2);
    expect(result.reason).toMatch(/Failed to parse map/);
  });

  it('returns exit code 2 for non-v3 source maps', () => {
    const mapPath = path.join(tempDir, 'v2.map');
    fs.writeFileSync(mapPath, JSON.stringify({ version: 2, sources: ['a.js'] }));

    const result = validateSourceMap(mapPath);
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(2);
    expect(result.reason).toMatch(/not a v3 source map/);
  });

  it('returns exit code 3 for v3 maps with an empty sources array', () => {
    const mapPath = path.join(tempDir, 'empty.map');
    fs.writeFileSync(mapPath, JSON.stringify({ version: 3, sources: [] }));

    const result = validateSourceMap(mapPath);
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(3);
    expect(result.sourcesCount).toBe(0);
    expect(result.reason).toMatch(/has no sources/);
  });

  it('returns exit code 3 when sources is missing', () => {
    const mapPath = path.join(tempDir, 'no-sources-key.map');
    fs.writeFileSync(mapPath, JSON.stringify({ version: 3, mappings: '' }));

    const result = validateSourceMap(mapPath);
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(3);
    expect(result.reason).toMatch(/has no sources/);
  });

  it('returns exit code 3 when sources is not an array', () => {
    const mapPath = path.join(tempDir, 'bad-sources.map');
    fs.writeFileSync(
      mapPath,
      JSON.stringify({ version: 3, sources: 'not-an-array', mappings: '' })
    );

    const result = validateSourceMap(mapPath);
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(3);
    expect(result.reason).toMatch(/has no sources/);
  });

  it('returns ok=true and the sources count for valid v3 maps', () => {
    const mapPath = path.join(tempDir, 'good.map');
    fs.writeFileSync(
      mapPath,
      JSON.stringify({ version: 3, sources: ['a.js', 'b.js', 'c.js'], mappings: '' })
    );

    const result = validateSourceMap(mapPath);
    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.version).toBe(3);
    expect(result.sourcesCount).toBe(3);
  });
});

describe('runMetroUpload — config resolution', () => {
  let tempDir: string;
  let stdoutSpy: jest.SpiedFunction<typeof process.stdout.write>;
  let stderrSpy: jest.SpiedFunction<typeof process.stderr.write>;

  const baseCliOpts = {
    gzip: true,
    verbose: false,
    dryRun: true,
  };

  beforeEach(() => {
    tempDir = createTempDir();
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    jest.mocked(faroIndex.uploadCompressedSourceMaps).mockClear();
    jest.mocked(faroIndex.uploadSourceMap).mockClear();
  });

  afterEach(() => {
    removeTempDir(tempDir);
  });

  it('returns exit code 2 listing every missing setting when no flags or env vars are set', async () => {
    const mapPath = writeValidMap(tempDir);

    const code = await runMetroUpload({ ...baseCliOpts, map: mapPath });

    expect(code).toBe(2);
    const stderr = stderrSpy.mock.calls.map((call) => String(call[0])).join('');
    expect(stderr).toMatch(/Missing required settings/);
    expect(stderr).toMatch(/--endpoint or FARO_SOURCEMAP_ENDPOINT/);
    expect(stderr).toMatch(/--app-id or FARO_SOURCEMAP_APP_ID/);
    expect(stderr).toMatch(/--stack-id or FARO_SOURCEMAP_STACK_ID/);
    expect(stderr).toMatch(/--api-key or FARO_SOURCEMAP_API_KEY/);
    expect(stderr).toMatch(/--bundle-id or FARO_BUNDLE_ID/);
  });

  it('falls back to FARO_* env vars when CLI flags are omitted (dry-run path)', async () => {
    const mapPath = writeValidMap(tempDir);
    process.env.FARO_SOURCEMAP_ENDPOINT = 'https://faro.example.test/api/v1';
    process.env.FARO_SOURCEMAP_APP_ID = '123';
    process.env.FARO_SOURCEMAP_STACK_ID = '456';
    process.env.FARO_SOURCEMAP_API_KEY = 'env-key';
    process.env.FARO_BUNDLE_ID = 'env-bundle';

    const code = await runMetroUpload({ ...baseCliOpts, map: mapPath });

    expect(code).toBe(0);
    const stdout = stdoutSpy.mock.calls.map((call) => String(call[0])).join('');
    expect(stdout).toMatch(
      /endpoint   : https:\/\/faro\.example\.test\/api\/v1\/app\/123\/sourcemaps\/env-bundle/
    );
    expect(stdout).toMatch(/bundleId   : env-bundle/);
    expect(stdout).toMatch(/Dry run/);
    // Sanity check: platform tag flags were removed, so the summary must not
    // mention them (regression guard against re-introducing the platform line).
    expect(stdout).not.toMatch(/platform/);
  });

  it('trims whitespace on FARO_* env values', async () => {
    const mapPath = writeValidMap(tempDir);
    process.env.FARO_SOURCEMAP_ENDPOINT = '  https://trim.example.test/api  ';
    process.env.FARO_SOURCEMAP_APP_ID = '123';
    process.env.FARO_SOURCEMAP_STACK_ID = '456';
    process.env.FARO_SOURCEMAP_API_KEY = 'key';
    process.env.FARO_BUNDLE_ID = 'bun';

    const code = await runMetroUpload({ ...baseCliOpts, map: mapPath });

    expect(code).toBe(0);
    const stdout = stdoutSpy.mock.calls.map((call) => String(call[0])).join('');
    expect(stdout).toMatch(
      /endpoint   : https:\/\/trim\.example\.test\/api\/app\/123\/sourcemaps\/bun/
    );
  });

  it('CLI flags win over env vars', async () => {
    const mapPath = writeValidMap(tempDir);
    process.env.FARO_SOURCEMAP_ENDPOINT = 'https://env.example.test';
    process.env.FARO_SOURCEMAP_APP_ID = 'env-app';
    process.env.FARO_SOURCEMAP_STACK_ID = 'env-stack';
    process.env.FARO_SOURCEMAP_API_KEY = 'env-key';
    process.env.FARO_BUNDLE_ID = 'env-bundle';

    const code = await runMetroUpload({
      ...baseCliOpts,
      map: mapPath,
      endpoint: 'https://flag.example.test/api/v1/',
      appId: 'flag-app',
      stackId: 'flag-stack',
      apiKey: 'flag-key',
      bundleId: 'flag-bundle',
    });

    expect(code).toBe(0);
    const stdout = stdoutSpy.mock.calls.map((call) => String(call[0])).join('');
    // Trailing slash on the endpoint should be normalized away.
    expect(stdout).toMatch(
      /endpoint   : https:\/\/flag\.example\.test\/api\/v1\/app\/flag-app\/sourcemaps\/flag-bundle/
    );
    expect(stdout).toMatch(/bundleId   : flag-bundle/);
  });

  it('accepts an arbitrary map filename — the CLI does not assume any specific filename', async () => {
    const mapPath = writeValidMap(tempDir, 'arbitrary-name.bundle.map');

    const code = await runMetroUpload({
      ...baseCliOpts,
      map: mapPath,
      endpoint: 'https://faro.example.test',
      appId: 'app',
      stackId: 'stack',
      apiKey: 'key',
      bundleId: 'bundle',
    });

    expect(code).toBe(0);
    const stdout = stdoutSpy.mock.calls.map((call) => String(call[0])).join('');
    expect(stdout).toMatch(/arbitrary-name\.bundle\.map/);
  });

  it('propagates validateSourceMap exit code 3 for v3 maps with empty sources', async () => {
    const mapPath = path.join(tempDir, 'empty.map');
    fs.writeFileSync(mapPath, JSON.stringify({ version: 3, sources: [] }));

    const code = await runMetroUpload({
      ...baseCliOpts,
      map: mapPath,
      endpoint: 'https://faro.example.test',
      appId: 'app',
      stackId: 'stack',
      apiKey: 'key',
      bundleId: 'bundle',
    });

    expect(code).toBe(3);
  });
});

describe('runMetroUpload — validation errors (integration)', () => {
  let tempDir: string;
  let stderrSpy: jest.SpiedFunction<typeof process.stderr.write>;

  beforeEach(() => {
    tempDir = createTempDir();
    jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    jest.mocked(faroIndex.uploadCompressedSourceMaps).mockClear();
    jest.mocked(faroIndex.uploadSourceMap).mockClear();
  });

  afterEach(() => {
    removeTempDir(tempDir);
  });

  it('returns exit code 2 when the map file is missing', async () => {
    const code = await runMetroUpload({
      gzip: true,
      verbose: false,
      dryRun: true,
      map: path.join(tempDir, 'missing.map'),
      ...fullConnectionOpts,
    });

    expect(code).toBe(2);
    const stderr = stderrSpy.mock.calls.map((call) => String(call[0])).join('');
    expect(stderr).toMatch(/Source map not found/);
  });

  it('returns exit code 2 when the map JSON is invalid', async () => {
    const mapPath = path.join(tempDir, 'bad.map');
    fs.writeFileSync(mapPath, '{');

    const code = await runMetroUpload({
      gzip: true,
      verbose: false,
      dryRun: true,
      map: mapPath,
      ...fullConnectionOpts,
    });

    expect(code).toBe(2);
    const stderr = stderrSpy.mock.calls.map((call) => String(call[0])).join('');
    expect(stderr).toMatch(/Failed to parse map/);
  });

  it('returns exit code 2 when the map is not v3', async () => {
    const mapPath = path.join(tempDir, 'v2.map');
    fs.writeFileSync(mapPath, JSON.stringify({ version: 2, sources: ['a.js'] }));

    const code = await runMetroUpload({
      gzip: true,
      verbose: false,
      dryRun: true,
      map: mapPath,
      ...fullConnectionOpts,
    });

    expect(code).toBe(2);
    const stderr = stderrSpy.mock.calls.map((call) => String(call[0])).join('');
    expect(stderr).toMatch(/not a v3 source map/);
  });

  it('does not call upload helpers when validation fails', async () => {
    const mapPath = path.join(tempDir, 'bad.map');
    fs.writeFileSync(mapPath, '{');

    await runMetroUpload({
      gzip: true,
      verbose: false,
      dryRun: false,
      map: mapPath,
      ...fullConnectionOpts,
    });

    expect(faroIndex.uploadCompressedSourceMaps).not.toHaveBeenCalled();
    expect(faroIndex.uploadSourceMap).not.toHaveBeenCalled();
  });
});

describe('runMetroUpload — file size limit', () => {
  let tempDir: string;
  let stderrSpy: jest.SpiedFunction<typeof process.stderr.write>;

  beforeEach(() => {
    tempDir = createTempDir();
    jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    jest.mocked(faroIndex.uploadCompressedSourceMaps).mockClear().mockResolvedValue(true);
    jest.mocked(faroIndex.uploadSourceMap).mockClear().mockResolvedValue(true);
  });

  afterEach(() => {
    removeTempDir(tempDir);
  });

  it('returns exit code 2 when the map exceeds the default max size', async () => {
    const mapPath = writeValidMap(tempDir);
    jest.spyOn(fs, 'statSync').mockReturnValue({ size: THIRTY_MB_IN_BYTES + 1 } as fs.Stats);

    const code = await runMetroUpload({
      gzip: true,
      verbose: false,
      dryRun: false,
      map: mapPath,
      ...fullConnectionOpts,
    });

    expect(code).toBe(2);
    const stderr = stderrSpy.mock.calls.map((call) => String(call[0])).join('');
    expect(stderr).toMatch(/byte limit/);
    expect(faroIndex.uploadCompressedSourceMaps).not.toHaveBeenCalled();
  });

  it('returns exit code 2 when the map exceeds a custom maxUploadSize', async () => {
    const mapPath = writeValidMap(tempDir);
    jest.spyOn(fs, 'statSync').mockReturnValue({ size: 500 } as fs.Stats);

    const code = await runMetroUpload({
      gzip: true,
      verbose: false,
      dryRun: false,
      map: mapPath,
      maxUploadSize: 400,
      ...fullConnectionOpts,
    });

    expect(code).toBe(2);
    expect(faroIndex.uploadCompressedSourceMaps).not.toHaveBeenCalled();
  });

  it('uses default limit when maxUploadSize is zero', async () => {
    const mapPath = writeValidMap(tempDir);
    jest.spyOn(fs, 'statSync').mockReturnValue({ size: THIRTY_MB_IN_BYTES + 1 } as fs.Stats);

    const code = await runMetroUpload({
      gzip: true,
      verbose: false,
      dryRun: false,
      map: mapPath,
      maxUploadSize: 0,
      ...fullConnectionOpts,
    });

    expect(code).toBe(2);
    const stderr = stderrSpy.mock.calls.map((call) => String(call[0])).join('');
    expect(stderr).toMatch(new RegExp(`${THIRTY_MB_IN_BYTES}`));
  });
});

describe('runMetroUpload — upload delegation', () => {
  let tempDir: string;
  let stdoutSpy: jest.SpiedFunction<typeof process.stdout.write>;
  let stderrSpy: jest.SpiedFunction<typeof process.stderr.write>;

  beforeEach(() => {
    tempDir = createTempDir();
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    jest.mocked(faroIndex.uploadCompressedSourceMaps).mockReset().mockResolvedValue(true);
    jest.mocked(faroIndex.uploadSourceMap).mockReset().mockResolvedValue(true);
  });

  afterEach(() => {
    removeTempDir(tempDir);
  });

  it('calls uploadCompressedSourceMaps when gzip is true', async () => {
    const mapPath = writeValidMap(tempDir);
    const resolvedMap = path.resolve(mapPath);

    const code = await runMetroUpload({
      gzip: true,
      verbose: false,
      dryRun: false,
      map: mapPath,
      endpoint: 'https://e.test/',
      appId: 'aid',
      stackId: 'sid',
      apiKey: 'secret',
      bundleId: 'bid',
    });

    expect(code).toBe(0);
    expect(faroIndex.uploadCompressedSourceMaps).toHaveBeenCalledTimes(1);
    expect(faroIndex.uploadSourceMap).not.toHaveBeenCalled();
    expect(faroIndex.uploadCompressedSourceMaps).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: 'https://e.test',
        appId: 'aid',
        stackId: 'sid',
        apiKey: 'secret',
        bundleId: 'bid',
        outputPath: path.dirname(resolvedMap),
        files: [resolvedMap],
        keepSourcemaps: true,
        verbose: false,
      })
    );
    const stdout = stdoutSpy.mock.calls.map((call) => String(call[0])).join('');
    expect(stdout).toMatch(/Upload complete/);
  });

  it('calls uploadSourceMap when gzip is false', async () => {
    const mapPath = writeValidMap(tempDir, 'main.js.map');
    const resolvedMap = path.resolve(mapPath);

    const code = await runMetroUpload({
      gzip: false,
      verbose: false,
      dryRun: false,
      map: mapPath,
      ...fullConnectionOpts,
    });

    expect(code).toBe(0);
    expect(faroIndex.uploadSourceMap).toHaveBeenCalledTimes(1);
    expect(faroIndex.uploadCompressedSourceMaps).not.toHaveBeenCalled();
    expect(faroIndex.uploadSourceMap).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: 'https://faro.example.test',
        filePath: resolvedMap,
        filename: 'main.js.map',
        keepSourcemaps: true,
      })
    );
  });

  it('forwards proxy and proxyUser to the upload helper', async () => {
    const mapPath = writeValidMap(tempDir);

    await runMetroUpload({
      gzip: false,
      verbose: false,
      dryRun: false,
      map: mapPath,
      proxy: 'http://proxy.example',
      proxyUser: 'user:pass',
      ...fullConnectionOpts,
    });

    expect(faroIndex.uploadSourceMap).toHaveBeenCalledWith(
      expect.objectContaining({
        proxy: 'http://proxy.example',
        proxyUser: 'user:pass',
      })
    );
  });

  it('forwards maxUploadSize to the upload helper', async () => {
    const mapPath = writeValidMap(tempDir);

    await runMetroUpload({
      gzip: true,
      verbose: false,
      dryRun: false,
      map: mapPath,
      maxUploadSize: 9_000_000,
      ...fullConnectionOpts,
    });

    expect(faroIndex.uploadCompressedSourceMaps).toHaveBeenCalledWith(
      expect.objectContaining({ maxUploadSize: 9_000_000 })
    );
  });

  it('returns exit code 1 when upload returns false', async () => {
    const mapPath = writeValidMap(tempDir);
    jest.mocked(faroIndex.uploadCompressedSourceMaps).mockResolvedValueOnce(false);

    const code = await runMetroUpload({
      gzip: true,
      verbose: false,
      dryRun: false,
      map: mapPath,
      ...fullConnectionOpts,
    });

    expect(code).toBe(1);
    const stderr = stderrSpy.mock.calls.map((call) => String(call[0])).join('');
    expect(stderr).toMatch(/Metro composed source map upload failed/);
  });

  it('passes verbose=true through to the gzip upload helper', async () => {
    const mapPath = writeValidMap(tempDir);

    await runMetroUpload({
      gzip: true,
      verbose: true,
      dryRun: false,
      map: mapPath,
      ...fullConnectionOpts,
    });

    expect(faroIndex.uploadCompressedSourceMaps).toHaveBeenCalledWith(
      expect.objectContaining({ verbose: true })
    );
  });
});

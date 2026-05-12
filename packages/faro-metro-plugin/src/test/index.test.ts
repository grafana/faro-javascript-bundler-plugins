import { describe, expect, test, afterEach, beforeEach } from '@jest/globals';
import { jest as jestGlobal } from '@jest/globals';
import defaultWithFaroConfig, {
  createFaroMetroCustomSerializer,
  computeSkipUpload,
  shiftGeneratedLineNumbers,
  normalizeBundleIdLength,
  resolveBundleId,
} from '../index';
import {
  uploadCompressedSourceMaps,
  uploadSourceMap,
} from '@grafana/faro-bundlers-shared';

jestGlobal.mock('@grafana/faro-bundlers-shared', () => {
  const actual = jestGlobal.requireActual('@grafana/faro-bundlers-shared') as Record<string, unknown>;
  return {
    ...actual,
    uploadCompressedSourceMaps: jestGlobal.fn(),
    uploadSourceMap: jestGlobal.fn(),
  };
});

const mockUploadCompressed = jestGlobal.mocked(uploadCompressedSourceMaps);
const mockUploadPlain = jestGlobal.mocked(uploadSourceMap);

describe('@grafana/faro-metro-plugin', () => {
  test('withFaroConfig attaches customSerializer', () => {
    const cfg = defaultWithFaroConfig(
      { projectRoot: '/x' },
      {
        appName: 'metro-test',
        endpoint: 'http://localhost:8000/faro/api/v1',
        appId: '1',
        stackId: 'stack',
        apiKey: 'key',
      }
    );
    expect(typeof (cfg.serializer as { customSerializer: unknown }).customSerializer).toBe(
      'function'
    );
  });

  test('resolveBundleId uses env FARO_BUNDLE_ID with trimming via hash when too long', () => {
    const longId = 'a'.repeat(600);
    const prev = process.env.FARO_BUNDLE_ID;
    process.env.FARO_BUNDLE_ID = longId;
    try {
      const id = resolveBundleId(undefined, false, false);
      expect(id.length).toBeLessThanOrEqual(512);
      expect(id.length).toBe(32);
    } finally {
      if (prev === undefined) {
        delete process.env.FARO_BUNDLE_ID;
      } else {
        process.env.FARO_BUNDLE_ID = prev;
      }
    }
  });

  test('normalizeBundleIdLength leaves short ids', () => {
    expect(normalizeBundleIdLength('abc')).toBe('abc');
  });

  test('computeSkipUpload respects FARO_SKIP_SOURCEMAP_UPLOAD true or 1', () => {
    const baseOpts = {
      appName: 'x',
      endpoint: 'http://e/a',
      appId: '1',
      stackId: 's',
      apiKey: 'k',
    };
    const prevNode = process.env.NODE_ENV;
    const prevSkip = process.env.FARO_SKIP_SOURCEMAP_UPLOAD;
    try {
      process.env.NODE_ENV = 'production';
      process.env.FARO_SKIP_SOURCEMAP_UPLOAD = 'true';
      expect(
        computeSkipUpload({
          ...baseOpts,
        })
      ).toBe(true);
      process.env.FARO_SKIP_SOURCEMAP_UPLOAD = 'TRUE';
      expect(computeSkipUpload({ ...baseOpts })).toBe(true);
      process.env.FARO_SKIP_SOURCEMAP_UPLOAD = '0';
      expect(computeSkipUpload({ ...baseOpts })).toBe(false);
      process.env.FARO_SKIP_SOURCEMAP_UPLOAD = '1';
      expect(computeSkipUpload({ ...baseOpts })).toBe(true);
    } finally {
      process.env.NODE_ENV = prevNode;
      if (prevSkip === undefined) {
        delete process.env.FARO_SKIP_SOURCEMAP_UPLOAD;
      } else {
        process.env.FARO_SKIP_SOURCEMAP_UPLOAD = prevSkip;
      }
    }
  });

  test('shiftGeneratedLineNumbers offsets mappings', async () => {
    const map = {
      version: 3,
      file: 'out.js',
      sources: ['a.js'],
      names: [],
      sourcesContent: ['console.log(1);\n'],
      mappings: 'AAAA',
    };
    const shifted = await shiftGeneratedLineNumbers(map, 1);
    expect(shifted.version).toBe(3);
  });

  describe('custom serializer', () => {
    const baseOptions = () => {
      const ids = new Map<string, number>();
      let n = 1;
      const createModuleId = (p: string) => {
        if (!ids.has(p)) ids.set(p, n++);
        return ids.get(p)!;
      };
      return {
        asyncRequireModulePath: '',
        processModuleFilter: () => true,
        createModuleId,
        getRunModuleStatement: (_moduleId: string) => `__r(${_moduleId});`,
        globalPrefix: '',
        dev: false,
        includeAsyncPaths: false,
        projectRoot: '/app',
        modulesOnly: false,
        runBeforeMainModule: [] as string[],
        runModule: true,
        sourceMapUrl: 'index.bundle.map',
        sourceUrl: '',
        inlineSourceMap: false,
        serverRoot: '/app',
        shouldAddToIgnoreList: () => false,
        getSourceUrl: () => '',
      };
    };

    afterEach(() => {
      delete process.env.FARO_BUNDLE_ID;
      delete process.env.FARO_SKIP_SOURCEMAP_UPLOAD;
      mockUploadCompressed.mockClear();
      mockUploadPlain.mockClear();
    });

    test('prepends faro bundle id snippet (release bundle)', async () => {
      process.env.FARO_BUNDLE_ID = 'release-id-1';
      const serializer = createFaroMetroCustomSerializer(null, {
        appName: 'rn-app',
        endpoint: 'http://localhost:8000/faro/api/v1',
        appId: '42',
        stackId: 'stack',
        apiKey: 'k',
        skipUpload: true,
      });
      const graph = { dependencies: new Map() };
      const out = await serializer('/app/index.js', [], graph, baseOptions());
      expect(out.code).toContain('__faroBundleId_rn-app');
      expect(out.code).toContain('"release-id-1"');
      const parsed = JSON.parse(out.map) as { version: number };
      expect(parsed.version).toBe(3);
    });

    test('uses dev placeholder when dev or skip', async () => {
      const serializer = createFaroMetroCustomSerializer(null, {
        appName: 'rn-app',
        endpoint: 'http://localhost:8000/faro/api/v1',
        appId: '42',
        stackId: 'stack',
        apiKey: 'k',
        skipUpload: true,
      });
      const graph = { dependencies: new Map() };
      const opts = { ...baseOptions(), dev: true };
      const out = await serializer('/app/index.js', [], graph, opts);
      expect(out.code).toMatch(/dev-[a-f0-9]+/);
    });

    describe('release upload to source map API', () => {
      let prevNodeEnv: string | undefined;

      beforeEach(() => {
        prevNodeEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        mockUploadCompressed.mockResolvedValue(true);
        mockUploadPlain.mockResolvedValue(true);
      });

      afterEach(() => {
        if (prevNodeEnv === undefined) {
          delete process.env.NODE_ENV;
        } else {
          process.env.NODE_ENV = prevNodeEnv;
        }
      });

      test('POST …/app/{appId}/sourcemaps/{bundleId} with gzip tarball (201)', async () => {
        process.env.FARO_BUNDLE_ID = 'rel-201-test';
        const serializer = createFaroMetroCustomSerializer(null, {
          appName: 'rn-app',
          endpoint: 'https://kwl.example.com/api/v1/',
          appId: 'app-42',
          stackId: 'stackZ',
          apiKey: 'secret',
          skipUpload: false,
          gzipContents: true,
        });
        const graph = { dependencies: new Map() };
        await serializer('/app/index.js', [], graph, baseOptions());

        expect(mockUploadCompressed).toHaveBeenCalledTimes(1);
        expect(mockUploadPlain).not.toHaveBeenCalled();
        expect(mockUploadCompressed).toHaveBeenCalledWith(
          expect.objectContaining({
            sourcemapEndpoint:
              'https://kwl.example.com/api/v1/app/app-42/sourcemaps/rel-201-test',
            apiKey: 'secret',
            stackId: 'stackZ',
          })
        );
        const call = mockUploadCompressed.mock.calls[0][0];
        expect(Array.isArray(call.files)).toBe(true);
        expect(call.files?.length).toBe(1);
        expect(String(call.files?.[0] ?? '')).toMatch(/bundle\.js\.map$/);
      });

      test('POST uses same bundleId segment when FARO_BUNDLE_ID is over max length (hashed)', async () => {
        const longId = 'b'.repeat(600);
        process.env.FARO_BUNDLE_ID = longId;
        const expectedSegment = normalizeBundleIdLength(longId);

        const serializer = createFaroMetroCustomSerializer(null, {
          appName: 'rn-app',
          endpoint: 'http://localhost:8000/api/v1',
          appId: '7',
          stackId: 's',
          apiKey: 'k',
          skipUpload: false,
        });
        const graph = { dependencies: new Map() };
        await serializer('/app/index.js', [], graph, baseOptions());

        expect(mockUploadCompressed).toHaveBeenCalledWith(
          expect.objectContaining({
            sourcemapEndpoint: `http://localhost:8000/api/v1/app/7/sourcemaps/${expectedSegment}`,
          })
        );
        expect(expectedSegment).toMatch(/^[a-f0-9]{32}$/);
      });

      test('gzipContents false uses uploadSourceMap with same sourcemapEndpoint', async () => {
        process.env.FARO_BUNDLE_ID = 'plain-upload';
        const serializer = createFaroMetroCustomSerializer(null, {
          appName: 'rn-app',
          endpoint: 'http://localhost:8000/api/v1',
          appId: '1',
          stackId: 'st',
          apiKey: 'key',
          skipUpload: false,
          gzipContents: false,
        });
        const graph = { dependencies: new Map() };
        await serializer('/app/index.js', [], graph, baseOptions());

        expect(mockUploadPlain).toHaveBeenCalledTimes(1);
        expect(mockUploadCompressed).not.toHaveBeenCalled();
        expect(mockUploadPlain).toHaveBeenCalledWith(
          expect.objectContaining({
            sourcemapEndpoint:
              'http://localhost:8000/api/v1/app/1/sourcemaps/plain-upload',
            apiKey: 'key',
            stackId: 'st',
          })
        );
        const plainCall = mockUploadPlain.mock.calls[0][0];
        expect(String(plainCall.filePath ?? '')).toMatch(/bundle\.js\.map$/);
      });

      test('does not throw when uploadCompressedSourceMaps returns false (API error path)', async () => {
        process.env.FARO_BUNDLE_ID = 'err-path';
        mockUploadCompressed.mockResolvedValueOnce(false);
        const serializer = createFaroMetroCustomSerializer(null, {
          appName: 'rn-app',
          endpoint: 'http://localhost:8000/api/v1',
          appId: '9',
          stackId: 's',
          apiKey: 'k',
          skipUpload: false,
        });
        const graph = { dependencies: new Map() };
        await expect(
          serializer('/app/index.js', [], graph, baseOptions())
        ).resolves.toMatchObject({ code: expect.stringContaining('__faroBundleId_rn-app') });

        expect(mockUploadCompressed).toHaveBeenCalledWith(
          expect.objectContaining({
            sourcemapEndpoint: 'http://localhost:8000/api/v1/app/9/sourcemaps/err-path',
          })
        );
      });
    });
  });
});

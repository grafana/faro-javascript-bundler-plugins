import { describe, expect, test, afterEach } from '@jest/globals';
import defaultWithFaroConfig, {
  createFaroMetroCustomSerializer,
  computeSkipUpload,
  shiftGeneratedLineNumbers,
  normalizeBundleIdLength,
  resolveBundleId,
} from '../index';

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

  test('resolveBundleId uses Gradle-aligned FARO_BUNDLE_ID from env', () => {
    const prev = process.env.FARO_BUNDLE_ID;
    process.env.FARO_BUNDLE_ID = 'com.test.app@42@1.0.0';
    try {
      const id = resolveBundleId({}, false, false);
      expect(id).toBe('com.test.app@42@1.0.0');
    } finally {
      if (prev === undefined) {
        delete process.env.FARO_BUNDLE_ID;
      } else {
        process.env.FARO_BUNDLE_ID = prev;
      }
    }
  });

  test('resolveBundleId hashes long env id on iOS (no Android format enforcement)', () => {
    const longId = 'a'.repeat(600);
    const prev = process.env.FARO_BUNDLE_ID;
    const prevPlatform = process.env.FARO_PLATFORM;
    process.env.FARO_BUNDLE_ID = longId;
    process.env.FARO_PLATFORM = 'ios';
    try {
      const id = resolveBundleId({}, false, false);
      expect(id.length).toBeLessThanOrEqual(512);
      expect(id.length).toBe(32);
    } finally {
      if (prev === undefined) {
        delete process.env.FARO_BUNDLE_ID;
      } else {
        process.env.FARO_BUNDLE_ID = prev;
      }
      if (prevPlatform === undefined) {
        delete process.env.FARO_PLATFORM;
      } else {
        process.env.FARO_PLATFORM = prevPlatform;
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
    });

    test('prepends faro bundle id snippet (release bundle)', async () => {
      process.env.FARO_BUNDLE_ID = 'com.test.app@1@1.0';
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
      expect(out.code).toContain('"com.test.app@1@1.0"');
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
  });
});

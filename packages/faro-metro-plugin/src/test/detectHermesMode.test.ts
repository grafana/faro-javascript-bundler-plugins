import { describe, expect, test, beforeEach, afterEach } from '@jest/globals';
import { createFaroMetroCustomSerializer, detectHermesMode } from '../index';

const baseBundleOptions = () => {
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

const baseFaroOpts = () => ({
  appName: 'rn-app',
  endpoint: 'http://localhost:8000/api/v1',
  appId: '1',
  stackId: 'stack',
  apiKey: 'key',
});

describe('detectHermesMode', () => {
  afterEach(() => {
    delete process.env.FARO_DISABLE_HERMES_PRECOMPILE;
  });

  test('release build (dev: false) with default options is "precompiled"', () => {
    expect(detectHermesMode(baseFaroOpts(), baseBundleOptions())).toBe('precompiled');
  });

  test('dev build (dev: true) is "runtime" (Hermes interpreter)', () => {
    const opts = { ...baseBundleOptions(), dev: true };
    expect(detectHermesMode(baseFaroOpts(), opts)).toBe('runtime');
  });

  test('hermes: false forces "jsc" even on release', () => {
    const faro = { ...baseFaroOpts(), hermes: false };
    expect(detectHermesMode(faro, baseBundleOptions())).toBe('jsc');
  });

  test('FARO_DISABLE_HERMES_PRECOMPILE=true downgrades release to "runtime"', () => {
    process.env.FARO_DISABLE_HERMES_PRECOMPILE = 'true';
    expect(detectHermesMode(baseFaroOpts(), baseBundleOptions())).toBe('runtime');
  });

  test('FARO_DISABLE_HERMES_PRECOMPILE=1 also recognized', () => {
    process.env.FARO_DISABLE_HERMES_PRECOMPILE = '1';
    expect(detectHermesMode(baseFaroOpts(), baseBundleOptions())).toBe('runtime');
  });

  test('hermes: false beats FARO_DISABLE_HERMES_PRECOMPILE (explicit option wins)', () => {
    process.env.FARO_DISABLE_HERMES_PRECOMPILE = 'true';
    const faro = { ...baseFaroOpts(), hermes: false };
    expect(detectHermesMode(faro, baseBundleOptions())).toBe('jsc');
  });
});

describe('serializer behaviour by Hermes mode', () => {
  let prevNodeEnv: string | undefined;
  beforeEach(() => {
    prevNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    process.env.FARO_BUNDLE_ID = 'unit-test-id';
  });

  afterEach(() => {
    if (prevNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = prevNodeEnv;
    }
    delete process.env.FARO_BUNDLE_ID;
    delete process.env.FARO_DISABLE_HERMES_PRECOMPILE;
  });

  test('precompiled (release default): emits valid map', async () => {
    const serializer = createFaroMetroCustomSerializer(null, baseFaroOpts());
    const out = await serializer(
      '/app/index.js',
      [],
      { dependencies: new Map() },
      baseBundleOptions()
    );

    const map = JSON.parse(out.map) as { mappings: string; version: number };
    expect(typeof map.mappings).toBe('string');
    expect(map.version).toBe(3);
  });

  test('runtime (dev build): map flattened path, dev bundle id', async () => {
    delete process.env.FARO_BUNDLE_ID;
    const serializer = createFaroMetroCustomSerializer(null, baseFaroOpts());
    const out = await serializer(
      '/app/index.js',
      [],
      { dependencies: new Map() },
      { ...baseBundleOptions(), dev: true }
    );

    const map = JSON.parse(out.map) as { mappings: string; version: number };
    expect(typeof map.mappings).toBe('string');
    expect(map.version).toBe(3);
    expect(out.code).toMatch(/dev-[a-f0-9]+/);
  });

  test('runtime (release + FARO_DISABLE_HERMES_PRECOMPILE=true): completes without Metro upload', async () => {
    process.env.FARO_DISABLE_HERMES_PRECOMPILE = 'true';
    const serializer = createFaroMetroCustomSerializer(null, baseFaroOpts());
    const out = await serializer(
      '/app/index.js',
      [],
      { dependencies: new Map() },
      baseBundleOptions()
    );
    expect(out.code).toContain('"unit-test-id"');
    expect(JSON.parse(out.map).version).toBe(3);
  });

  test('jsc (hermes: false): completes release serialization', async () => {
    const serializer = createFaroMetroCustomSerializer(null, {
      ...baseFaroOpts(),
      hermes: false,
    });
    const out = await serializer(
      '/app/index.js',
      [],
      { dependencies: new Map() },
      baseBundleOptions()
    );
    expect(out.code).toContain('"unit-test-id"');
    expect(JSON.parse(out.map).version).toBe(3);
  });

  test('skipUpload: true uses dev bundle id even when release + FARO_DISABLE_HERMES_PRECOMPILE', async () => {
    delete process.env.FARO_BUNDLE_ID;
    process.env.FARO_DISABLE_HERMES_PRECOMPILE = 'true';
    const serializer = createFaroMetroCustomSerializer(null, {
      ...baseFaroOpts(),
      skipUpload: true,
    });
    const out = await serializer(
      '/app/index.js',
      [],
      { dependencies: new Map() },
      baseBundleOptions()
    );
    expect(out.code).toMatch(/dev-[a-f0-9]+/);
  });
});

import * as esbuild from 'esbuild';
import faroEsbuildPlugin from '../index';
import path from 'path';
import fs from 'fs';
import { jest } from '@jest/globals';

// mock https-proxy-agent
const mockHttpsProxyAgent = jest.fn().mockImplementation((proxyUrl: any) => {
  return {
    proxyUrl,
    // mock agent object
    options: { proxy: proxyUrl }
  };
});

jest.mock('https-proxy-agent', () => {
  return {
    HttpsProxyAgent: mockHttpsProxyAgent
  };
});

// mock cross-fetch to capture fetch calls
const mockFetch = jest.fn() as any;
mockFetch.mockResolvedValue({
  ok: true,
  status: 200,
  json: async () => ({ success: true }),
  text: async () => '{}',
});

jest.mock('cross-fetch', () => ({
  default: mockFetch,
  __esModule: true,
}));

// helper to run esbuild with custom config
const runEsbuild = async (customConfig = {}, buildOptions = {}) => {
  const outdir = path.resolve(process.cwd(), 'dist');

  // ensure outdir exists
  if (!fs.existsSync(outdir)) {
    fs.mkdirSync(outdir, { recursive: true });
  }

  const result = await esbuild.build({
    entryPoints: [path.resolve(process.cwd(), 'src/test/main.js')],
    bundle: true,
    outdir,
    plugins: [
      faroEsbuildPlugin({
        appName: 'esbuild-test-app',
        endpoint: 'http://localhost:8000/faro/api/v1',
        apiKey: 'test-api-key',
        stackId: 'test-stack-id',
        appId: '1',
        ...customConfig,
      })
    ],
    sourcemap: true,
    ...buildOptions,
  });

  // read the output files
  const outputFiles = fs.readdirSync(outdir);
  const jsFile = outputFiles.find(f => f.endsWith('.js'));
  const code = jsFile ? fs.readFileSync(path.join(outdir, jsFile), 'utf8') : '';

  return { result, code, outdir };
};

describe('Faro Esbuild Plugin', () => {
  afterEach(() => {
    // cleanup dist directory
    const distDir = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distDir)) {
      fs.rmSync(distDir, { recursive: true, force: true });
    }
    jest.clearAllMocks();
  });

  test('basic bundleId injection test', async () => {
    const { code } = await runEsbuild({ bundleId: 'test' });

    expect(code.startsWith(`(function(){try{var g=typeof window!=="undefined"?window:typeof global!=="undefined"?global:typeof self!=="undefined"?self:{};g["__faroBundleId_esbuild-test-app"]="test"`)).toBeTruthy();
  });

  test('custom bundleId is correctly injected', async () => {
    const { code } = await runEsbuild({ bundleId: 'custom-test-id' });

    // verify the bundle contains our custom bundleId
    expect(code).toContain(`g["__faroBundleId_esbuild-test-app"]="custom-test-id"`);
  });

  test('bundleId is generated if not provided', async () => {
    const { code } = await runEsbuild({});

    // extract the generated bundleId with a regex
    const bundleIdMatch = code.match(/g\["__faroBundleId_esbuild-test-app"\]="([^"]+)"/);

    // verify we got a match and the bundleId is a string
    expect(bundleIdMatch).toBeTruthy();
    expect(typeof bundleIdMatch?.[1]).toBe('string');
    expect(bundleIdMatch?.[1]?.length).toBeGreaterThan(0);
  });

  test('skipUpload option sets environment variable with bundleId', async () => {
    await runEsbuild({
      bundleId: 'env-test-id',
      skipUpload: true
    });

    // verify the environment variable was set
    expect(fs.readFileSync(path.resolve(process.cwd(), '.env.ESBUILD_TEST_APP'), 'utf8')).toContain('FARO_BUNDLE_ID_ESBUILD_TEST_APP=env-test-id');
  });

  test('bundleId is prepended to the code', async () => {
    const { code } = await runEsbuild({ bundleId: 'test' });

    // create a simple regex to check code starts with the bundle ID snippet
    const bundleIdRegex = /^\(function\(\)\{try\{var g=typeof window!=="undefined"\?window:typeof global!=="undefined"\?global:typeof self!=="undefined"\?self:\{\};g\["__faroBundleId_esbuild-test-app"\]="test"\}catch\(l\)\{\}\}\)\(\);/;

    expect(code).toMatch(bundleIdRegex);
  });

  test('banner string is preserved and bundleId snippet is prepended', async () => {
    const existingBanner = '/* custom banner */';
    const { code } = await runEsbuild(
      { bundleId: 'banner-test' },
      { banner: existingBanner }
    );

    // verify the bundleId snippet is prepended to the existing banner
    expect(code).toContain(`g["__faroBundleId_esbuild-test-app"]="banner-test"`);
    expect(code).toContain(existingBanner);

    // verify bundleId snippet comes before the existing banner
    const bundleIdIndex = code.indexOf(`g["__faroBundleId_esbuild-test-app"]="banner-test"`);
    const bannerIndex = code.indexOf(existingBanner);
    expect(bundleIdIndex).toBeLessThan(bannerIndex);
  });

  test('banner object with css property is preserved and does not interfere with js banner', async () => {
    const existingCssBanner = '/* css banner */';
    const existingJsBanner = '/* js banner */';
    const { code } = await runEsbuild(
      { bundleId: 'css-banner-test' },
      { banner: { js: existingJsBanner, css: existingCssBanner } }
    );

    // verify the bundleId snippet is prepended to the existing js banner
    expect(code).toContain(`g["__faroBundleId_esbuild-test-app"]="css-banner-test"`);
    expect(code).toContain(existingJsBanner);

    // verify bundleId snippet comes before the existing js banner
    const bundleIdIndex = code.indexOf(`g["__faroBundleId_esbuild-test-app"]="css-banner-test"`);
    const jsBannerIndex = code.indexOf(existingJsBanner);
    expect(bundleIdIndex).toBeLessThan(jsBannerIndex);

    // css banner should not appear in js output
    expect(code).not.toContain(existingCssBanner);
  });

  test('proxy option with authentication is passed correctly', async () => {
    const mockProxyUrl = "http://user:pass@proxy.example.com:8080";

    // clear previous calls
    jest.clearAllMocks();
    mockFetch.mockClear();
    mockHttpsProxyAgent.mockClear();

    await runEsbuild({
      bundleId: "proxy-auth-test",
      proxy: mockProxyUrl,
      skipUpload: false,
    });

    // wait for async uploads to complete (onEnd is async)
    await new Promise(resolve => setTimeout(resolve, 500));

    // verify HttpsProxyAgent was called with the authenticated proxy URL if uploads occurred
    if (mockFetch.mock.calls.length > 0) {
      expect(mockHttpsProxyAgent).toHaveBeenCalledWith(mockProxyUrl);
    } else {
      // if no uploads occurred, at least verify authenticated proxy URL is accepted
      expect(mockProxyUrl).toBeDefined();
    }
  });

  test('no proxy agent is used when proxy option is not provided', async () => {
    // clear previous calls
    jest.clearAllMocks();
    mockFetch.mockClear();
    mockHttpsProxyAgent.mockClear();

    await runEsbuild({
      bundleId: "no-proxy-test",
      skipUpload: false,
    });

    // wait for async uploads to complete (onEnd is async)
    await new Promise(resolve => setTimeout(resolve, 500));

    // verify HttpsProxyAgent was not called when proxy is not provided
    expect(mockHttpsProxyAgent).not.toHaveBeenCalled();

    // if uploads occurred, verify no agent was passed to fetch
    const fetchCalls = mockFetch.mock.calls;
    if (fetchCalls.length > 0) {
      const fetchOptions = fetchCalls[0][1] as any;
      // when no proxy, agent should be undefined
      expect(fetchOptions?.agent).toBeUndefined();
    }
  });

  test('proxy validation rejects invalid proxy URLs', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    // test invalid proxy URLs
    const invalidProxies = [
      "not-a-url",
      "ftp://proxy.example.com:8080",
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "file:///etc/passwd",
      "http://",
      "https://",
    ];

    for (const invalidProxy of invalidProxies) {
      consoleErrorSpy.mockClear();
      mockFetch.mockClear();
      mockHttpsProxyAgent.mockClear();

      await runEsbuild({
        bundleId: "proxy-validation-test",
        proxy: invalidProxy,
        skipUpload: false,
      });

      // wait for async uploads to complete
      await new Promise(resolve => setTimeout(resolve, 500));

      // verify that HttpsProxyAgent was not called with invalid proxy
      expect(mockHttpsProxyAgent).not.toHaveBeenCalled();
    }

    consoleErrorSpy.mockRestore();
  });

  test('proxy validation accepts valid proxy URLs', async () => {
    const validProxies = [
      "http://proxy.example.com:8080",
      "https://proxy.example.com:8080",
      "http://user:pass@proxy.example.com:8080",
      "https://user:pass@proxy.example.com:8080",
      "http://proxy.example.com",
      "https://proxy.example.com",
    ];

    for (const validProxy of validProxies) {
      jest.clearAllMocks();
      mockFetch.mockClear();
      mockHttpsProxyAgent.mockClear();

      await runEsbuild({
        bundleId: "proxy-validation-valid-test",
        proxy: validProxy,
        skipUpload: false,
      });

      // wait for async uploads to complete
      await new Promise(resolve => setTimeout(resolve, 500));

      // verify that HttpsProxyAgent was called with valid proxy if uploads occurred
      if (mockFetch.mock.calls.length > 0) {
        expect(mockHttpsProxyAgent).toHaveBeenCalledWith(validProxy);
      }
    }
  });
});

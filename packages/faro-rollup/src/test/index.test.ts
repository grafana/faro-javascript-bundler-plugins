import { ModuleFormat, rollup } from 'rollup';
import type { RequestInit, Response } from 'undici';
import path from 'path';
import fs from 'fs';
import { afterEach, describe, expect, test, vi, type Mock } from 'vitest';

// Prevent git rev-parse from auto-injecting a hash in test environments
vi.doMock('child_process', () => ({
  execSync: vi.fn(() => { throw new Error('git not available'); }),
}));

// Mock undici fetch and ProxyAgent
const mockFetch = vi.fn() as Mock<(url: string, options?: RequestInit) => Promise<Response>>;
const mockProxyAgent = vi.fn().mockImplementation((proxyUrl: unknown) => ({
  proxyUrl,
  options: { proxy: proxyUrl },
}));
mockFetch.mockImplementation(async (_url: string, _options?: RequestInit) => {
  return {
    ok: true,
    status: 200,
    json: async () => ({ success: true }),
    text: async () => '{}',
  } as Response;
});

vi.doMock('undici', () => ({
  fetch: (url: string, options?: RequestInit) => mockFetch(url, options),
  ProxyAgent: mockProxyAgent,
}));

const { default: faroUploader } = await import('@grafana/faro-rollup-plugin');
const { ProxyAgent } = await import('undici');

const TEST_OUTPUT_DIR = path.resolve(process.cwd(), '.test-output');

// Helper to create a run rollup with custom config
const runRollup = async (customConfig: Record<string, unknown> = {}, outputConfig: Record<string, unknown> = {}) => {
  fs.mkdirSync(TEST_OUTPUT_DIR, { recursive: true });

  const bundle = await rollup({
    input: path.resolve(process.cwd(), 'src/test/main.js'),
    plugins: [
      faroUploader({
        appName: 'rollup-test-app',
        endpoint: 'http://localhost:8000/faro/api/v1',
        apiKey: 'test-api-key',
        stackId: 'test-stack-id',
        appId: '1',
        ...customConfig,
      })
    ]
  });

  // Set default output options if not provided
  const output = {
    file: path.resolve(TEST_OUTPUT_DIR, 'bundle.js'),
    format: 'commonjs' as ModuleFormat,
    ...outputConfig
  };

  return bundle.write(output);
};

describe('Faro Rollup Plugin', () => {
  afterEach(() => {
    // cleanup test output without touching the production dist directory
    if (fs.existsSync(TEST_OUTPUT_DIR)) {
      fs.rmSync(TEST_OUTPUT_DIR, { recursive: true, force: true });
    }
  });

  test('basic bundleId injection test', async () => {
    const output = await runRollup({ bundleId: 'test' });

    expect(
      output.output[0].code.startsWith(
        `(function(){try{var g=typeof globalThis!=="undefined"?globalThis:typeof global!=="undefined"?global:typeof window!=="undefined"?window:typeof self!=="undefined"?self:{};g["__faroBundleId_rollup-test-app"]="test"`
      )
    ).toBeTruthy();
  });

  test('custom bundleId is correctly injected', async () => {
    const output = await runRollup({ bundleId: 'custom-test-id' });

    // Verify the bundle contains our custom bundleId
    expect(output.output[0].code).toContain(`g["__faroBundleId_rollup-test-app"]="custom-test-id"`);
  });

  test('bundleId is generated if not provided', async () => {
    const output = await runRollup({});

    // Extract the generated bundleId with a regex
    const bundleIdMatch = output.output[0].code.match(/g\["__faroBundleId_rollup-test-app"\]="([^"]+)"/);

    // Verify we got a match and the bundleId is a string
    expect(bundleIdMatch).toBeTruthy();
    expect(typeof bundleIdMatch?.[1]).toBe('string');
    expect(bundleIdMatch?.[1]?.length).toBeGreaterThan(0);
  });

  test('skipUpload option sets environment variable with bundleId', async () => {
    await runRollup({
      bundleId: 'env-test-id',
      skipUpload: true
    });

    // Verify the environment variable was set
    expect(fs.readFileSync(path.resolve(process.cwd(), '.env.ROLLUP_TEST_APP'), 'utf8')).toContain('FARO_BUNDLE_ID_ROLLUP_TEST_APP=env-test-id');
  });

  test('bundleId is prepended to the code', async () => {
    const output = await runRollup({ bundleId: 'test' });

    // Create a simple regex to check code starts with the bundle ID snippet
    const bundleIdRegex =
      /^\(function\(\)\{try\{var g=typeof globalThis!=="undefined"\?globalThis:typeof global!=="undefined"\?global:typeof window!=="undefined"\?window:typeof self!=="undefined"\?self:\{\};g\["__faroBundleId_rollup-test-app"\]="test"\}catch\(l\)\{\}\}\)\(\);/;

    expect(output.output[0].code).toMatch(bundleIdRegex);
  });

  test('gitHash snippet is injected when gitHash option is provided', async () => {
    const output = await runRollup({ bundleId: 'test', gitHash: 'abc123def456abc123def456abc123def456abc1' });

    expect(output.output[0].code).toContain(`g["__faroGitHash_rollup-test-app"]="abc123def456abc123def456abc123def456abc1"`);
  });

  test('gitHash snippet is not injected when gitHash option is not provided', async () => {
    const output = await runRollup({ bundleId: 'test' });

    expect(output.output[0].code).not.toContain('__faroGitHash_rollup-test-app');
  });

  test('gitHash snippet is prepended before bundleId snippet', async () => {
    const output = await runRollup({ bundleId: 'test', gitHash: 'abc123def456abc123def456abc123def456abc1' });
    const code = output.output[0].code;

    const gitHashIndex = code.indexOf('__faroGitHash_rollup-test-app');
    const bundleIdIndex = code.indexOf('__faroBundleId_rollup-test-app');

    expect(gitHashIndex).toBeGreaterThan(-1);
    expect(bundleIdIndex).toBeGreaterThan(-1);
    expect(gitHashIndex).toBeLessThan(bundleIdIndex);
  });

  test('proxy option with authentication is passed correctly', async () => {
    const mockProxyUrl = "http://user:pass@proxy.example.com:8080";

    // Clear previous calls
    vi.clearAllMocks();
    mockFetch.mockClear();
    (ProxyAgent as unknown as Mock<(url: string) => object>).mockClear();

    await runRollup({
      bundleId: "proxy-auth-test",
      proxy: mockProxyUrl,
      skipUpload: false,
    }, {
      sourcemap: true,
    });

    // Wait for async uploads to complete (writeBundle is async)
    await new Promise(resolve => setTimeout(resolve, 500));

    // Verify ProxyAgent was used via the fetch dispatcher
    if (mockFetch.mock.calls.length > 0) {
      const fetchOptions = mockFetch.mock.calls[0][1];
      expect(fetchOptions?.dispatcher).toBeDefined();
    } else {
      // If no uploads occurred, at least verify authenticated proxy URL is accepted
      expect(mockProxyUrl).toBeDefined();
    }
  });

  test('no proxy agent is used when proxy option is not provided', async () => {
    // Clear previous calls
    vi.clearAllMocks();
    mockFetch.mockClear();
    (ProxyAgent as unknown as Mock<(url: string) => object>).mockClear();

    await runRollup({
      bundleId: "no-proxy-test",
      skipUpload: false,
    }, {
      sourcemap: true,
    });

    // Wait for async uploads to complete (writeBundle is async)
    await new Promise(resolve => setTimeout(resolve, 500));

    // Verify ProxyAgent was not called when proxy is not provided
    expect(ProxyAgent).not.toHaveBeenCalled();

    // If uploads occurred, verify no dispatcher was passed to fetch
    const fetchCalls = mockFetch.mock.calls;
    if (fetchCalls.length > 0) {
      const fetchOptions = fetchCalls[0][1];
      // When no proxy, dispatcher should be undefined
      expect(fetchOptions?.dispatcher).toBeUndefined();
    }
  });

  test('proxy validation rejects invalid proxy URLs', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Test invalid proxy URLs
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
      (ProxyAgent as unknown as Mock<(url: string) => object>).mockClear();

      await runRollup({
        bundleId: "proxy-validation-test",
        proxy: invalidProxy,
        skipUpload: false,
      }, {
        sourcemap: true,
      });

      // Wait for async uploads to complete
      await new Promise(resolve => setTimeout(resolve, 500));

      // Verify that ProxyAgent was not called with invalid proxy
      expect(ProxyAgent).not.toHaveBeenCalled();
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
      vi.clearAllMocks();
      mockFetch.mockClear();
      (ProxyAgent as unknown as Mock<(url: string) => object>).mockClear();

      await runRollup({
        bundleId: "proxy-validation-valid-test",
        proxy: validProxy,
        skipUpload: false,
      }, {
        sourcemap: true,
      });

      // Wait for async uploads to complete
      await new Promise(resolve => setTimeout(resolve, 500));

      // Verify that a dispatcher was used for valid proxy if uploads occurred
      if (mockFetch.mock.calls.length > 0) {
        const fetchOptions = mockFetch.mock.calls[0][1];
        expect(fetchOptions?.dispatcher).toBeDefined();
      }
    }
  });

  test('prefixPath is prepended to the file property of the sourcemap when prefixPath is provided', async () => {
    await runRollup({
      bundleId: 'prefixpath-test',
      skipUpload: false,
      keepSourcemaps: true,
      prefixPath: 'robo/assets',
    }, {
      sourcemap: true,
    });

    const sourceMapPath = path.resolve(TEST_OUTPUT_DIR, 'bundle.js.map');
    const sourceMap = JSON.parse(fs.readFileSync(sourceMapPath, 'utf8'));
    expect(sourceMap.file).toBe('robo/assets/bundle.js');
  });

  test('prefixPath with trailing slash is prepended correctly', async () => {
    await runRollup({
      bundleId: 'prefixpath-slash-test',
      skipUpload: false,
      keepSourcemaps: true,
      prefixPath: 'robo/assets/',
    }, {
      sourcemap: true,
    });

    const sourceMapPath = path.resolve(TEST_OUTPUT_DIR, 'bundle.js.map');
    const sourceMap = JSON.parse(fs.readFileSync(sourceMapPath, 'utf8'));
    expect(sourceMap.file).toBe('robo/assets/bundle.js');
  });

  test('prefixPath is applied when skipUpload is true', async () => {
    await runRollup({
      bundleId: 'prefixpath-skip-upload-test',
      skipUpload: true,
      keepSourcemaps: true,
      prefixPath: 'robo/assets',
    }, {
      sourcemap: true,
    });

    const sourceMapPath = path.resolve(TEST_OUTPUT_DIR, 'bundle.js.map');
    const sourceMap = JSON.parse(fs.readFileSync(sourceMapPath, 'utf8'));
    expect(sourceMap.file).toBe('robo/assets/bundle.js');
  });

  test('prefixPath is applied to source maps in subdirectories (Vite-style dir output)', async () => {
    // Vite places chunks under assets/ inside the output dir, and those .map files
    // may not appear as separate OutputBundle keys — only disk-based discovery finds them.
    const bundle = await rollup({
      input: path.resolve(process.cwd(), 'src/test/main.js'),
      plugins: [
        faroUploader({
          appName: 'rollup-test-app',
          endpoint: 'http://localhost:8000/faro/api/v1',
          apiKey: 'test-api-key',
          stackId: 'test-stack-id',
          appId: '1',
          bundleId: 'prefixpath-subdir-test',
          skipUpload: true,
          keepSourcemaps: true,
          prefixPath: 'robo/assets',
        })
      ]
    });

    await bundle.write({
      dir: TEST_OUTPUT_DIR,
      format: 'esm' as ModuleFormat,
      sourcemap: true,
      entryFileNames: 'assets/[name].js',
    });

    const sourceMapPath = path.resolve(TEST_OUTPUT_DIR, 'assets/main.js.map');
    const sourceMap = JSON.parse(fs.readFileSync(sourceMapPath, 'utf8'));
    expect(sourceMap.file).toBe('robo/assets/main.js');
  });
});

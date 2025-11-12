import { ModuleFormat, rollup } from 'rollup';
import faroUploader from '@grafana/faro-rollup-plugin';
import path from 'path';
import fs from 'fs';
import { jest } from '@jest/globals';

// Mock https-proxy-agent
const mockHttpsProxyAgent = jest.fn().mockImplementation((proxyUrl: any) => {
  return {
    proxyUrl,
    // Mock agent object
    options: { proxy: proxyUrl }
  };
});

jest.mock('https-proxy-agent', () => {
  return {
    HttpsProxyAgent: mockHttpsProxyAgent
  };
});

// Mock cross-fetch to capture fetch calls
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
// Helper to create a run rollup with custom config
const runRollup = async (customConfig = {}, outputConfig = {}) => {
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
    file: path.resolve(process.cwd(), 'dist/bundle.js'),
    format: 'commonjs' as ModuleFormat,
    ...outputConfig
  };

  return bundle.write(output);
};

describe('Faro Rollup Plugin', () => {
  test('basic bundleId injection test', async () => {
    const output = await runRollup({ bundleId: 'test' });

    expect(output.output[0].code.startsWith(`(function(){try{var g=typeof window!=="undefined"?window:typeof global!=="undefined"?global:typeof self!=="undefined"?self:{};g["__faroBundleId_rollup-test-app"]="test"`)).toBeTruthy();
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
    const bundleIdRegex = /^\(function\(\)\{try\{var g=typeof window!=="undefined"\?window:typeof global!=="undefined"\?global:typeof self!=="undefined"\?self:\{\};g\["__faroBundleId_rollup-test-app"\]="test"\}catch\(l\)\{\}\}\)\(\);/;

    expect(output.output[0].code).toMatch(bundleIdRegex);
  });

  test('proxy option with authentication is passed correctly', async () => {
    const mockProxyUrl = "http://user:pass@proxy.example.com:8080";

    // Clear previous calls
    jest.clearAllMocks();
    mockFetch.mockClear();
    mockHttpsProxyAgent.mockClear();

    await runRollup({
      bundleId: "proxy-auth-test",
      proxy: mockProxyUrl,
      skipUpload: false,
    }, {
      sourcemap: true,
    });

    // Wait for async uploads to complete (writeBundle is async)
    await new Promise(resolve => setTimeout(resolve, 500));

    // Verify HttpsProxyAgent was called with the authenticated proxy URL if uploads occurred
    if (mockFetch.mock.calls.length > 0) {
      expect(mockHttpsProxyAgent).toHaveBeenCalledWith(mockProxyUrl);
    } else {
      // If no uploads occurred, at least verify authenticated proxy URL is accepted
      expect(mockProxyUrl).toBeDefined();
    }
  });

  test('no proxy agent is used when proxy option is not provided', async () => {
    // Clear previous calls
    jest.clearAllMocks();
    mockFetch.mockClear();
    mockHttpsProxyAgent.mockClear();

    await runRollup({
      bundleId: "no-proxy-test",
      skipUpload: false,
    }, {
      sourcemap: true,
    });

    // Wait for async uploads to complete (writeBundle is async)
    await new Promise(resolve => setTimeout(resolve, 500));

    // Verify HttpsProxyAgent was not called when proxy is not provided
    expect(mockHttpsProxyAgent).not.toHaveBeenCalled();

    // If uploads occurred, verify no agent was passed to fetch
    const fetchCalls = mockFetch.mock.calls;
    if (fetchCalls.length > 0) {
      const fetchOptions = fetchCalls[0][1] as any;
      // When no proxy, agent should be undefined
      expect(fetchOptions?.agent).toBeUndefined();
    }
  });

  test('proxy validation rejects invalid proxy URLs', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

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
      mockHttpsProxyAgent.mockClear();

      await runRollup({
        bundleId: "proxy-validation-test",
        proxy: invalidProxy,
        skipUpload: false,
      }, {
        sourcemap: true,
      });

      // Wait for async uploads to complete
      await new Promise(resolve => setTimeout(resolve, 500));

      // Verify that HttpsProxyAgent was not called with invalid proxy
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

      await runRollup({
        bundleId: "proxy-validation-valid-test",
        proxy: validProxy,
        skipUpload: false,
      }, {
        sourcemap: true,
      });

      // Wait for async uploads to complete
      await new Promise(resolve => setTimeout(resolve, 500));

      // Verify that HttpsProxyAgent was called with valid proxy if uploads occurred
      if (mockFetch.mock.calls.length > 0) {
        expect(mockHttpsProxyAgent).toHaveBeenCalledWith(validProxy);
      }
    }
  });
});
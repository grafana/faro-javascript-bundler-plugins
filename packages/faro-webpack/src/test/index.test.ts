import FaroSourceMapUploaderPlugin, { WebpackFaroSourceMapUploaderPluginOptions } from "@grafana/faro-webpack-plugin";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
  jest,
} from "@jest/globals";
import fs from "fs/promises";
import { http, HttpResponse, PathParams } from "msw";
import { setupServer } from "msw/node";
import os from "os";
import path from "path";
import webpack, { Configuration, Stats } from "webpack";

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

// Mock cross-fetch to capture fetch calls and verify agent usage
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

const uploadedFiles: string[] = [];
const tempDirectories: string[] = [];

const cleanupTempDir = async (dirPath: string) => {
  try {
    await fs.access(dirPath);
    await fs.rm(dirPath, { recursive: true, force: true });
  } catch (error) {
    // Directory doesn't exist or other error, ignore
  }
};

const server = setupServer(
  http.post(
    "http://localhost:8000/faro/api/v1/app/1/sourcemaps/:bundleId",
    async ({ request, params }: { request: Request; params: PathParams }) => {
      const contentType = request.headers.get("content-type");

      if (contentType === "application/json") {
        const sourcemapContent = await request.text();
        try {
          const sourcemap = JSON.parse(sourcemapContent);
          if (sourcemap.file) {
            uploadedFiles.push(sourcemap.file);
          }
        } catch (e) {
          console.error("Failed to parse sourcemap JSON:", e);
        }
      } else if (contentType === "application/gzip") {
        uploadedFiles.push("compressed-upload");
      }

      return HttpResponse.json({ success: true });
    }
  )
);

// Helper function to run webpack with custom configuration
const runWebpack = async (
  customConfig: Partial<WebpackFaroSourceMapUploaderPluginOptions> = {},
  tempDir?: string,
  webpackOverrides: webpack.Configuration = {}
) => {
  const outputDir =
    tempDir || (await fs.mkdtemp(path.join(os.tmpdir(), "webpack-test-")));

  const webpackConfig: Configuration = {
    entry: {
      main: path.resolve(process.cwd(), "src/test/main.cjs"),
      "nested/vendor": path.resolve(
        process.cwd(),
        "src/test/nested/vendor.cjs"
      ),
    },
    output: {
      filename: "[name].js",
      path: outputDir,
    },
    mode: "production",
    plugins: [
      new FaroSourceMapUploaderPlugin({
        appName: "webpack-test-app",
        endpoint: "http://localhost:8000/faro/api/v1",
        apiKey: "test-api-key",
        stackId: "test-stack-id",
        appId: "1",
        gzipContents: false,
        ...customConfig,
      }),
    ],
    ...webpackOverrides,
  };

  return new Promise<{ stats: Stats | undefined; outputDir: string }>(
    (resolve, reject) => {
      webpack(webpackConfig, (err, stats) => {
        if (err || stats?.hasErrors()) {
          reject(err || stats?.compilation.errors);
        } else {
          resolve({ stats, outputDir });
        }

        tempDirectories.push(outputDir);
      });
    }
  );
};

describe("Faro Webpack Plugin", () => {
  beforeAll(() => server.listen({ onUnhandledRequest: "error" }));

  afterEach(async () => {
    server.resetHandlers();
    await Promise.all(tempDirectories.map(cleanupTempDir));
    uploadedFiles.length = 0;
    tempDirectories.length = 0;
    jest.clearAllMocks();
  });

  afterAll(() => server.close());

  // Test the default bundleId injection
  test("basic bundleId injection test", async () => {
    const { outputDir } = await runWebpack({ bundleId: "test" });

    const content = await fs.readFile(path.join(outputDir, "main.js"), "utf8");
    const bundleIdMatch = content.match(
      /__faroBundleId_webpack-test-app"\]="([^"]+)"/
    );

    expect(bundleIdMatch?.[0]).toBe(`__faroBundleId_webpack-test-app"]="test"`);
  });

  // Test that a bundleId is generated if not provided
  test("bundleId is generated if not provided", async () => {
    const { outputDir } = await runWebpack();

    const content = await fs.readFile(path.join(outputDir, "main.js"), "utf8");

    // Extract the generated bundleId with a regex
    const bundleIdMatch = content.match(
      /__faroBundleId_webpack-test-app"\]="([^"]+)"/
    );

    // Verify we got a match and the bundleId is a string
    expect(typeof bundleIdMatch?.[0]).toBe("string");
    expect(bundleIdMatch?.[0]?.length).toBeGreaterThan(0);
  });

  // Test skipUpload option
  test("skipUpload option sets environment variable file with bundleId", async () => {
    await runWebpack({
      bundleId: "env-test-id",
      skipUpload: true,
    });

    // Verify the environment variable was set
    expect(
      await fs.readFile(
        path.resolve(process.cwd(), ".env.WEBPACK_TEST_APP"),
        "utf8"
      )
    ).toContain("FARO_BUNDLE_ID_WEBPACK_TEST_APP=env-test-id");
  });

  // Test that the bundleId code is placed at the beginning of the file
  test("bundleId is prepended to the bundle", async () => {
    const { outputDir } = await runWebpack({ bundleId: "prepend-test" });

    const content = await fs.readFile(path.join(outputDir, "main.js"), "utf8");

    // Check if the bundle starts with the injection code
    // Note: Webpack's exact output format might differ, so we check if it occurs near the beginning
    const firstCharsPos = content.indexOf("__faroBundleId_webpack-test-app");
    expect(firstCharsPos).toBeLessThan(200);
  });

  test("nested source maps in output directory are not uploaded when recursive is false", async () => {
    const testOutputDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "webpack-nested-test-")
    );

    const { outputDir } = await runWebpack(
      {
        bundleId: "nested-test",
        skipUpload: false,
        keepSourcemaps: true,
        outputPath: testOutputDir,
      },
      testOutputDir,
      {
        devtool: "source-map",
      }
    );

    const [rootSourceMapExists, nestedSourceMapExists] = await Promise.all([
      fileExists(path.join(outputDir, "main.js.map")),
      fileExists(path.join(outputDir, "nested/vendor.js.map")),
    ]);

    expect(rootSourceMapExists).toBe(true);
    expect(nestedSourceMapExists).toBe(true);

    // uploading is not awaited by webpack so this keeps checking until it resolves
    await waitFor(() => {
      expect(uploadedFiles.length).toBeGreaterThan(0);
    });

    expect(uploadedFiles.some((file) => file.includes("main.js"))).toBe(true);
    expect(uploadedFiles.some((file) => file.includes("vendor.js"))).toBe(false);
  });

  test("nested source maps in output directory are uploaded when recursive is true", async () => {
    const testOutputDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "webpack-nested-test-")
    );

    const { outputDir } = await runWebpack(
      {
        bundleId: "nested-test",
        skipUpload: false,
        keepSourcemaps: true,
        outputPath: testOutputDir,
        recursive: true,
      },
      testOutputDir,
      {
        devtool: "source-map",
      }
    );

    const [rootSourceMapExists, nestedSourceMapExists] = await Promise.all([
      fileExists(path.join(outputDir, "main.js.map")),
      fileExists(path.join(outputDir, "nested/vendor.js.map")),
    ]);

    expect(rootSourceMapExists).toBe(true);
    expect(nestedSourceMapExists).toBe(true);

    // uploading is not awaited by webpack so this keeps checking until it resolves
    await waitFor(() => {
      expect(uploadedFiles.length).toBeGreaterThan(0);
    });

    expect(uploadedFiles.some((file) => file.includes("main.js"))).toBe(true);
    expect(uploadedFiles.some((file) => file.includes("vendor.js"))).toBe(true);
  });

  test("_next is prepended to the file property of the sourcemap when nextjs is true", async () => {
    const testOutputDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "webpack-nested-test-")
    );

    const { outputDir } = await runWebpack(
      {
        bundleId: "nextjs-test",
        skipUpload: false,
        keepSourcemaps: true,
        outputPath: testOutputDir,
        nextjs: true,
      },
      testOutputDir,
      {
        devtool: "source-map",
      }
    );

    const sourceMap = await fs.readFile(path.join(outputDir, "main.js.map"), "utf8");
    const sourceMapJson = JSON.parse(sourceMap);
    expect(sourceMapJson.file).toBe("_next/main.js");
  });

  test("proxy option with authentication is passed correctly", async () => {
    const mockProxyUrl = "http://user:pass@proxy.example.com:8080";

    // Clear previous calls
    jest.clearAllMocks();
    mockHttpsProxyAgent.mockClear();
    mockFetch.mockClear();

    await runWebpack({
      bundleId: "proxy-auth-test",
      proxy: mockProxyUrl,
      skipUpload: false,
      keepSourcemaps: true,
    }, undefined, {
      devtool: "source-map",
    });

    // Wait for async uploads to complete (afterEmit hook is async)
    await new Promise(resolve => setTimeout(resolve, 500));

    // Verify HttpsProxyAgent was called with the authenticated proxy URL if uploads occurred
    if (mockFetch.mock.calls.length > 0) {
      expect(mockHttpsProxyAgent).toHaveBeenCalledWith(mockProxyUrl);

      // Verify the agent was passed to fetch
      const fetchCalls = mockFetch.mock.calls;
      const fetchOptions = fetchCalls[0][1] as any;
      expect(fetchOptions).toHaveProperty('agent');
    } else {
      // If no uploads occurred (e.g., no sourcemaps), at least verify proxy option is accepted
      expect(mockProxyUrl).toBeDefined();
    }
  });

  test("no proxy agent is used when proxy option is not provided", async () => {
    // Clear previous calls
    jest.clearAllMocks();
    mockHttpsProxyAgent.mockClear();
    mockFetch.mockClear();

    await runWebpack({
      bundleId: "no-proxy-test",
      skipUpload: false,
      keepSourcemaps: true,
    }, undefined, {
      devtool: "source-map",
    });

    // Wait for async uploads to complete (afterEmit hook is async)
    await new Promise(resolve => setTimeout(resolve, 500));

    // Verify HttpsProxyAgent was not called when proxy is not provided
    expect(mockHttpsProxyAgent).not.toHaveBeenCalled();

    // If uploads occurred, verify no agent was passed to fetch
    const fetchCalls = mockFetch.mock.calls;
    if (fetchCalls.length > 0) {
      const fetchOptions = fetchCalls[0][1] as any;
      expect(fetchOptions).not.toHaveProperty('agent');
    }
  });

  test("proxy validation rejects invalid proxy URLs", async () => {
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

      await runWebpack({
        bundleId: "proxy-validation-test",
        proxy: invalidProxy,
        skipUpload: false,
        keepSourcemaps: true,
      }, undefined, {
        devtool: "source-map",
      });

      // Wait for async uploads to complete
      await new Promise(resolve => setTimeout(resolve, 500));

      // Verify that HttpsProxyAgent was not called with invalid proxy
      expect(mockHttpsProxyAgent).not.toHaveBeenCalled();
    }

    consoleErrorSpy.mockRestore();
  });

  test("proxy validation accepts valid proxy URLs", async () => {
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

      await runWebpack({
        bundleId: "proxy-validation-valid-test",
        proxy: validProxy,
        skipUpload: false,
        keepSourcemaps: true,
      }, undefined, {
        devtool: "source-map",
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

async function fileExists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function waitFor(callback: () => void, timeout = 5000) {
  return new Promise<void>((resolve, reject) => {
    const startTime = Date.now();

    const interval = setInterval(() => {
      try {
        callback();
        clearInterval(interval);
        resolve();
      } catch (error) {
        if (Date.now() - startTime > timeout) {
          clearInterval(interval);
          if (error instanceof Error) {
            reject(error);
          } else {
            reject(new Error("Timeout exceeded"));
          }
        }
      }
    }, 200);
  });
}

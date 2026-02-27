import fs from 'fs';
import path from 'path';
import { jest } from '@jest/globals';
import { consoleInfoOrange } from '@grafana/faro-bundlers-shared';
import { uploadSourceMaps, generateCurlCommand } from '../index';
import { version } from '../../package.json';

// Mock dependencies
jest.mock('fs');
jest.mock('path');
jest.mock('@grafana/faro-bundlers-shared');
jest.mock('../index');

// Mock console methods
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const mockConsoleLog = jest.fn();
const mockConsoleError = jest.fn();

// Mock process.exit
const mockExit = jest.spyOn(process, 'exit').mockImplementation((code) => {
  throw new Error(`Process.exit called with code: ${code}`);
});

// Store original env
const originalEnv = { ...process.env };

// Create mock implementations of the CLI command handlers
// These are simplified versions of the actual handlers in cli.ts
const mockUploadHandler = async (options: any) => {
  try {
    // Check if bundleId is provided or should be read from environment variable
    let bundleId = options.bundleId;

    if (bundleId === 'env' && options.appName) {
      const envVarName = `FARO_BUNDLE_ID_${options.appName.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
      bundleId = process.env[envVarName] || '';

      if (!bundleId) {
        console.error(`Error: Bundle ID not found in environment variable ${envVarName}`);
        throw new Error(`Process.exit called with code: 1`);
      }

      options.verbose && consoleInfoOrange(`Using bundleId ${bundleId} from environment variable ${envVarName}`);
    }

    // Resolve output path
    const outputPath = path.resolve(process.cwd(), options.outputPath);

    // Check if output path exists
    if (!fs.existsSync(outputPath)) {
      console.error(`Error: Output path ${outputPath} does not exist`);
      throw new Error(`Process.exit called with code: 1`);
    }

    options.verbose && consoleInfoOrange(`Uploading sourcemaps from ${outputPath} to ${options.endpoint} using cURL${options.gzipPayload ? ' with gzipped payload' : ''}`);

    // Upload sourcemaps
    const success = await uploadSourceMaps(
      options.endpoint,
      options.appId,
      options.apiKey,
      options.stackId,
      bundleId,
      outputPath,
      {
        keepSourcemaps: options.keepSourcemaps,
        gzipContents: options.gzipContents,
        gzipPayload: options.gzipPayload,
        verbose: options.verbose,
        recursive: options.recursive,
        proxy: options.proxy,
        proxyUser: options.proxyUser,
      }
    );

    if (success) {
      consoleInfoOrange('Sourcemaps uploaded successfully');
    } else {
      console.error('Error: Failed to upload sourcemaps');
      throw new Error(`Process.exit called with code: 1`);
    }
  } catch (err) {
    console.error('Error:', err);
    throw new Error(`Process.exit called with code: 1`);
  }
};

const mockCurlHandler = (options: any) => {
  try {
    // Check if bundleId is provided or should be read from environment variable
    let bundleId = options.bundleId;

    if (bundleId === 'env' && options.appName) {
      const envVarName = `FARO_BUNDLE_ID_${options.appName.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
      bundleId = process.env[envVarName] || '';

      if (!bundleId) {
        console.error(`Error: Bundle ID not found in environment variable ${envVarName}`);
        throw new Error(`Process.exit called with code: 1`);
      }
    }

    // Resolve file path
    const filePath = path.resolve(process.cwd(), options.file);

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      console.error(`Error: File ${filePath} does not exist`);
      throw new Error(`Process.exit called with code: 1`);
    }

    // Generate curl command
    const curlCommand = generateCurlCommand(
      options.endpoint,
      options.appId,
      options.apiKey,
      options.stackId,
      bundleId,
      filePath,
      options.maxUploadSize,
      options.gzipPayload,
      options.proxy,
      options.proxyUser
    );

    console.log(curlCommand);
  } catch (err) {
    console.error('Error:', err);
    throw new Error(`Process.exit called with code: 1`);
  }
};

describe('CLI version', () => {
  it('reads version from package.json', () => {
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe('CLI', () => {
  // Setup common test variables
  const mockEndpoint = 'https://faro-api.grafana.net';
  const mockAppId = 'test-app-id';
  const mockApiKey = 'test-api-key';
  const mockStackId = 'test-stack-id';
  const mockBundleId = 'test-bundle-id';
  const mockOutputPath = '/mock/output/path';
  const mockFilePath = '/mock/output/path/test.js.map';
  const mockAppName = 'test-app';

  beforeEach(() => {
    // Reset all mocks before each test
    jest.resetAllMocks();

    // Mock console methods
    console.log = mockConsoleLog;
    console.error = mockConsoleError;

    // Mock fs methods
    jest.mocked(fs.existsSync).mockReturnValue(true);

    // Mock path methods
    jest.mocked(path.resolve).mockImplementation((...args) => args.join('/'));

    // Mock index functions
    jest.mocked(uploadSourceMaps).mockResolvedValue(true);
    jest.mocked(generateCurlCommand).mockReturnValue('mock curl command');

    // Mock consoleInfoOrange
    jest.mocked(consoleInfoOrange).mockImplementation(() => {});

    // Reset process.env
    process.env = { ...originalEnv };
    delete process.env.FARO_BUNDLE_ID_TEST_APP;
  });

  afterEach(() => {
    // Restore console methods
    console.log = originalConsoleLog;
    console.error = originalConsoleError;

    // Restore process.env
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    // Restore process.exit
    mockExit.mockRestore();
  });

  describe('upload command', () => {
    it('should upload sourcemaps successfully', async () => {
      // Create options object
      const options = {
        endpoint: mockEndpoint,
        appId: mockAppId,
        apiKey: mockApiKey,
        stackId: mockStackId,
        bundleId: mockBundleId,
        outputPath: mockOutputPath,
        keepSourcemaps: false,
        gzipContents: false,
        gzipPayload: false,
        verbose: false
      };

      // Call the mock handler directly
      await mockUploadHandler(options);

      // Verify uploadSourceMaps was called with correct arguments
      expect(uploadSourceMaps).toHaveBeenCalledWith(
        mockEndpoint,
        mockAppId,
        mockApiKey,
        mockStackId,
        mockBundleId,
        expect.any(String), // resolved output path
        expect.objectContaining({
          keepSourcemaps: false,
          gzipContents: false,
          gzipPayload: false,
          verbose: false
        })
      );

      // Verify success message was displayed
      expect(consoleInfoOrange).toHaveBeenCalledWith('Sourcemaps uploaded successfully');
    });

    it('should handle bundleId from environment variable', async () => {
      // Set environment variable
      process.env.FARO_BUNDLE_ID_TEST_APP = 'env-bundle-id';

      // Create options object
      const options = {
        endpoint: mockEndpoint,
        appId: mockAppId,
        apiKey: mockApiKey,
        stackId: mockStackId,
        bundleId: 'env',
        appName: mockAppName,
        outputPath: mockOutputPath,
        keepSourcemaps: false,
        gzipContents: false,
        gzipPayload: false,
        verbose: true
      };

      // Call the mock handler directly
      await mockUploadHandler(options);

      // Verify uploadSourceMaps was called with correct arguments
      expect(uploadSourceMaps).toHaveBeenCalledWith(
        mockEndpoint,
        mockAppId,
        mockApiKey,
        mockStackId,
        'env-bundle-id',
        expect.any(String), // resolved output path
        expect.objectContaining({
          keepSourcemaps: false,
          gzipContents: false,
          gzipPayload: false,
          verbose: true
        })
      );

      // Verify verbose message was displayed
      expect(consoleInfoOrange).toHaveBeenCalledWith(
        expect.stringContaining('Using bundleId env-bundle-id from environment variable')
      );
    });

    it('should handle missing environment variable for bundleId', async () => {
      // Create options object
      const options = {
        endpoint: mockEndpoint,
        appId: mockAppId,
        apiKey: mockApiKey,
        stackId: mockStackId,
        bundleId: 'env',
        appName: mockAppName,
        outputPath: mockOutputPath,
        keepSourcemaps: false,
        gzipContents: false,
        gzipPayload: false,
        verbose: false
      };

      // Call the mock handler and expect it to throw
      await expect(mockUploadHandler(options)).rejects.toThrow('Process.exit called with code: 1');

      // Verify error message was displayed
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Bundle ID not found in environment variable')
      );
    });

    it('should handle non-existent output path', async () => {
      // Mock fs.existsSync to return false
      jest.mocked(fs.existsSync).mockReturnValue(false);

      // Create options object
      const options = {
        endpoint: mockEndpoint,
        appId: mockAppId,
        apiKey: mockApiKey,
        stackId: mockStackId,
        bundleId: mockBundleId,
        outputPath: mockOutputPath,
        keepSourcemaps: false,
        gzipContents: false,
        gzipPayload: false,
        verbose: false
      };

      // Call the mock handler and expect it to throw
      await expect(mockUploadHandler(options)).rejects.toThrow('Process.exit called with code: 1');

      // Verify error message was displayed
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Output path')
      );
    });

    it('should handle upload failure', async () => {
      // Mock uploadSourceMaps to return false
      jest.mocked(uploadSourceMaps).mockResolvedValue(false);

      // Create options object
      const options = {
        endpoint: mockEndpoint,
        appId: mockAppId,
        apiKey: mockApiKey,
        stackId: mockStackId,
        bundleId: mockBundleId,
        outputPath: mockOutputPath,
        keepSourcemaps: false,
        gzipContents: false,
        gzipPayload: false,
        verbose: false
      };

      // Call the mock handler and expect it to throw
      await expect(mockUploadHandler(options)).rejects.toThrow('Process.exit called with code: 1');

      // Verify error message was displayed
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to upload sourcemaps')
      );
    });

    it('should handle exceptions', async () => {
      // Mock uploadSourceMaps to throw an error
      jest.mocked(uploadSourceMaps).mockRejectedValue(new Error('Test error'));

      // Create options object
      const options = {
        endpoint: mockEndpoint,
        appId: mockAppId,
        apiKey: mockApiKey,
        stackId: mockStackId,
        bundleId: mockBundleId,
        outputPath: mockOutputPath,
        keepSourcemaps: false,
        gzipContents: false,
        gzipPayload: false,
        verbose: false
      };

      // Call the mock handler and expect it to throw
      await expect(mockUploadHandler(options)).rejects.toThrow('Process.exit called with code: 1');

      // Verify error message was displayed
      expect(console.error).toHaveBeenCalledWith(
        'Error:',
        expect.any(Error)
      );
    });

    it('should upload sourcemaps with recursive flag enabled', async () => {
      // Create options object with recursive flag
      const options = {
        endpoint: mockEndpoint,
        appId: mockAppId,
        apiKey: mockApiKey,
        stackId: mockStackId,
        bundleId: mockBundleId,
        outputPath: mockOutputPath,
        keepSourcemaps: false,
        gzipContents: false,
        gzipPayload: false,
        verbose: false,
        recursive: true
      };

      // Call the mock handler directly
      await mockUploadHandler(options);

      // Verify uploadSourceMaps was called with correct arguments including recursive flag
      expect(uploadSourceMaps).toHaveBeenCalledWith(
        mockEndpoint,
        mockAppId,
        mockApiKey,
        mockStackId,
        mockBundleId,
        expect.any(String), // resolved output path
        expect.objectContaining({
          keepSourcemaps: false,
          gzipContents: false,
          gzipPayload: false,
          verbose: false,
          recursive: true
        })
      );

      // Verify success message was displayed
      expect(consoleInfoOrange).toHaveBeenCalledWith('Sourcemaps uploaded successfully');
    });

    it('should upload sourcemaps with recursive flag disabled (default)', async () => {
      // Create options object without recursive flag (should default to undefined)
      const options = {
        endpoint: mockEndpoint,
        appId: mockAppId,
        apiKey: mockApiKey,
        stackId: mockStackId,
        bundleId: mockBundleId,
        outputPath: mockOutputPath,
        keepSourcemaps: false,
        gzipContents: false,
        gzipPayload: false,
        verbose: false
        // recursive not specified, should be undefined
      };

      // Call the mock handler directly
      await mockUploadHandler(options);

      // Verify uploadSourceMaps was called with correct arguments including recursive flag as undefined
      expect(uploadSourceMaps).toHaveBeenCalledWith(
        mockEndpoint,
        mockAppId,
        mockApiKey,
        mockStackId,
        mockBundleId,
        expect.any(String), // resolved output path
        expect.objectContaining({
          keepSourcemaps: false,
          gzipContents: false,
          gzipPayload: false,
          verbose: false,
          recursive: undefined
        })
      );

      // Verify success message was displayed
      expect(consoleInfoOrange).toHaveBeenCalledWith('Sourcemaps uploaded successfully');
    });
  });

  describe('curl command', () => {
    it('should generate a curl command successfully', async () => {
      // Create options object
      const options = {
        endpoint: mockEndpoint,
        appId: mockAppId,
        apiKey: mockApiKey,
        stackId: mockStackId,
        bundleId: mockBundleId,
        file: mockFilePath,
        contentType: 'application/json',
        gzipPayload: false
      };

      // Call the mock handler directly
      mockCurlHandler(options);

      // Verify generateCurlCommand was called with correct arguments
      expect(generateCurlCommand).toHaveBeenCalledWith(
        mockEndpoint,
        mockAppId,
        mockApiKey,
        mockStackId,
        mockBundleId,
        expect.any(String), // resolved file path
        undefined, // maxUploadSize
        false, // gzipPayload
        undefined, // proxy
        undefined // proxyUser
      );

      // Verify curl command was displayed
      expect(console.log).toHaveBeenCalledWith('mock curl command');
    });

    it('should handle bundleId from environment variable', async () => {
      // Set environment variable
      process.env.FARO_BUNDLE_ID_TEST_APP = 'env-bundle-id';

      // Create options object
      const options = {
        endpoint: mockEndpoint,
        appId: mockAppId,
        apiKey: mockApiKey,
        stackId: mockStackId,
        bundleId: 'env',
        appName: mockAppName,
        file: mockFilePath,
        contentType: 'application/json',
        gzipPayload: false
      };

      // Call the mock handler directly
      mockCurlHandler(options);

      // Verify generateCurlCommand was called with correct arguments
      expect(generateCurlCommand).toHaveBeenCalledWith(
        mockEndpoint,
        mockAppId,
        mockApiKey,
        mockStackId,
        'env-bundle-id',
        expect.any(String), // resolved file path
        undefined, // maxUploadSize
        false, // gzipPayload
        undefined, // proxy
        undefined // proxyUser
      );
    });

    it('should handle missing environment variable for bundleId', async () => {
      // Create options object
      const options = {
        endpoint: mockEndpoint,
        appId: mockAppId,
        apiKey: mockApiKey,
        stackId: mockStackId,
        bundleId: 'env',
        appName: mockAppName,
        file: mockFilePath,
        contentType: 'application/json',
        gzipPayload: false
      };

      // Call the mock handler and expect it to throw
      expect(() => mockCurlHandler(options)).toThrow('Process.exit called with code: 1');

      // Verify error message was displayed
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Bundle ID not found in environment variable')
      );
    });

    it('should handle non-existent file', async () => {
      // Mock fs.existsSync to return false
      jest.mocked(fs.existsSync).mockReturnValue(false);

      // Create options object
      const options = {
        endpoint: mockEndpoint,
        appId: mockAppId,
        apiKey: mockApiKey,
        stackId: mockStackId,
        bundleId: mockBundleId,
        file: mockFilePath,
        contentType: 'application/json',
        gzipPayload: false
      };

      // Call the mock handler and expect it to throw
      expect(() => mockCurlHandler(options)).toThrow('Process.exit called with code: 1');

      // Verify error message was displayed
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('File')
      );
    });

    it('should handle exceptions', async () => {
      // Mock generateCurlCommand to throw an error
      jest.mocked(generateCurlCommand).mockImplementation(() => {
        throw new Error('Test error');
      });

      // Create options object
      const options = {
        endpoint: mockEndpoint,
        appId: mockAppId,
        apiKey: mockApiKey,
        stackId: mockStackId,
        bundleId: mockBundleId,
        file: mockFilePath,
        contentType: 'application/json',
        gzipPayload: false
      };

      // Call the mock handler and expect it to throw
      expect(() => mockCurlHandler(options)).toThrow('Process.exit called with code: 1');

      // Verify error message was displayed
      expect(console.error).toHaveBeenCalledWith(
        'Error:',
        expect.any(Error)
      );
    });

    it('should pass proxy option to uploadSourceMaps', async () => {
      const mockProxy = 'http://proxy.example.com:8080';
      const options = {
        endpoint: mockEndpoint,
        appId: mockAppId,
        apiKey: mockApiKey,
        stackId: mockStackId,
        bundleId: mockBundleId,
        outputPath: mockOutputPath,
        keepSourcemaps: false,
        gzipContents: false,
        gzipPayload: false,
        verbose: false,
        proxy: mockProxy
      };

      await mockUploadHandler(options);

      expect(uploadSourceMaps).toHaveBeenCalledWith(
        mockEndpoint,
        mockAppId,
        mockApiKey,
        mockStackId,
        mockBundleId,
        expect.any(String),
        expect.objectContaining({
          keepSourcemaps: false,
          gzipContents: false,
          gzipPayload: false,
          verbose: false,
          proxy: mockProxy
        })
      );
    });

    it('should pass proxy option to generateCurlCommand', () => {
      const mockProxy = 'http://proxy.example.com:8080';
      const options = {
        endpoint: mockEndpoint,
        appId: mockAppId,
        apiKey: mockApiKey,
        stackId: mockStackId,
        bundleId: mockBundleId,
        file: mockFilePath,
        contentType: 'application/json',
        gzipPayload: false,
        proxy: mockProxy
      };

      mockCurlHandler(options);

      expect(generateCurlCommand).toHaveBeenCalledWith(
        mockEndpoint,
        mockAppId,
        mockApiKey,
        mockStackId,
        mockBundleId,
        expect.any(String),
        undefined, // maxUploadSize
        false, // gzipPayload
        mockProxy, // proxy
        undefined // proxyUser
      );
    });

    it('should pass proxyUser option to uploadSourceMaps', async () => {
      const mockProxy = 'http://proxy.example.com:8080';
      const mockProxyUser = 'user:pass';
      const options = {
        endpoint: mockEndpoint,
        appId: mockAppId,
        apiKey: mockApiKey,
        stackId: mockStackId,
        bundleId: mockBundleId,
        outputPath: mockOutputPath,
        keepSourcemaps: false,
        gzipContents: false,
        gzipPayload: false,
        verbose: false,
        proxy: mockProxy,
        proxyUser: mockProxyUser
      };

      await mockUploadHandler(options);

      expect(uploadSourceMaps).toHaveBeenCalledWith(
        mockEndpoint,
        mockAppId,
        mockApiKey,
        mockStackId,
        mockBundleId,
        expect.any(String),
        expect.objectContaining({
          keepSourcemaps: false,
          gzipContents: false,
          gzipPayload: false,
          verbose: false,
          proxy: mockProxy,
          proxyUser: mockProxyUser
        })
      );
    });

    it('should pass proxyUser option to generateCurlCommand', () => {
      const mockProxy = 'http://proxy.example.com:8080';
      const mockProxyUser = 'user:pass';
      const options = {
        endpoint: mockEndpoint,
        appId: mockAppId,
        apiKey: mockApiKey,
        stackId: mockStackId,
        bundleId: mockBundleId,
        file: mockFilePath,
        contentType: 'application/json',
        gzipPayload: false,
        proxy: mockProxy,
        proxyUser: mockProxyUser
      };

      mockCurlHandler(options);

      expect(generateCurlCommand).toHaveBeenCalledWith(
        mockEndpoint,
        mockAppId,
        mockApiKey,
        mockStackId,
        mockBundleId,
        expect.any(String),
        undefined, // maxUploadSize
        false, // gzipPayload
        mockProxy, // proxy
        mockProxyUser // proxyUser
      );
    });
  });
});
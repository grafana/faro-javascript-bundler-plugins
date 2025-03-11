import fs from 'fs';
import path from 'path';
import * as tar from 'tar';
import { execSync } from 'child_process';
import { gzipSync } from 'zlib';
import { tmpdir } from 'os';
import { consoleInfoOrange, THIRTY_MB_IN_BYTES } from '@grafana/faro-bundlers-shared';
import { jest } from '@jest/globals';

import {
  uploadSourceMap,
  uploadCompressedSourceMaps,
  uploadSourceMaps,
  generateCurlCommand,
  UploadSourceMapOptions,
  UploadCompressedSourceMapsOptions,
  // findMapFiles
} from '../index';

// Mock dependencies
jest.mock('fs');
jest.mock('path');
jest.mock('tar', () => ({
  create: jest.fn(() => Promise.resolve())
}));
jest.mock('child_process');
jest.mock('zlib');
jest.mock('os');
jest.mock('@grafana/faro-bundlers-shared');

describe('faro-cli', () => {
  // Setup common test variables
  const mockEndpoint = 'https://faro-api.grafana.net';
  const mockAppId = 'test-app-id';
  const mockApiKey = 'test-api-key';
  const mockStackId = 'test-stack-id';
  const mockBundleId = 'test-bundle-id';
  const mockOutputPath = '/mock/output/path';
  const mockFilePath = '/mock/output/path/test.js.map';
  const mockFilename = 'test.js.map';

  // Mock console methods
  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;
  const mockConsoleError = jest.fn();
  const mockConsoleWarn = jest.fn();

  beforeEach(() => {
    // Reset all mocks before each test
    jest.resetAllMocks();

    // Mock console methods
    console.error = mockConsoleError;
    console.warn = mockConsoleWarn;

    // Mock fs methods
    jest.mocked(fs.existsSync).mockReturnValue(true);
    jest.mocked(fs.statSync).mockReturnValue({
      size: 1024 * 1024,
      isFile: () => true,
      isDirectory: () => false,
      isBlockDevice: () => false,
      isCharacterDevice: () => false,
      isSymbolicLink: () => false,
      isFIFO: () => false,
      isSocket: () => false
    } as unknown as fs.Stats);
    jest.mocked(fs.readFileSync).mockReturnValue(Buffer.from('mock file content'));
    jest.mocked(fs.writeFileSync).mockImplementation(() => {});
    jest.mocked(fs.unlinkSync).mockImplementation(() => {});

    // Mock path methods
    jest.mocked(path.basename).mockImplementation((filePath: string) => filePath.split('/').pop() || '');
    jest.mocked(path.join).mockImplementation((...args: string[]) => args.join('/'));

    // Mock child_process
    jest.mocked(execSync).mockReturnValue('{"success":true}');

    // Mock zlib
    jest.mocked(gzipSync).mockReturnValue(Buffer.from('gzipped content'));

    // Mock os
    jest.mocked(tmpdir).mockReturnValue('/tmp');

    // Mock shared functions
    jest.mocked(consoleInfoOrange).mockImplementation(() => {});
  });

  afterEach(() => {
    // Restore console methods
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
  });

  describe('uploadSourceMap', () => {
    const mockOptions: UploadSourceMapOptions = {
      endpoint: mockEndpoint,
      appId: mockAppId,
      apiKey: mockApiKey,
      stackId: mockStackId,
      bundleId: mockBundleId,
      filePath: mockFilePath,
      filename: mockFilename,
      keepSourcemaps: false,
      verbose: true
    };

    it('should upload a sourcemap file successfully', async () => {
      const result = await uploadSourceMap(mockOptions);

      expect(result).toBe(true);
      expect(execSync).toHaveBeenCalledTimes(1);
      expect(execSync).toHaveBeenCalledWith(
        expect.stringContaining(`curl -s -X POST`),
        expect.any(Object)
      );
    });

    it('should delete the sourcemap file if keepSourcemaps is false', async () => {
      await uploadSourceMap(mockOptions);

      expect(fs.unlinkSync).toHaveBeenCalledWith(mockFilePath);
    });

    it('should not delete the sourcemap file if keepSourcemaps is true', async () => {
      await uploadSourceMap({
        ...mockOptions,
        keepSourcemaps: true
      });

      expect(fs.unlinkSync).not.toHaveBeenCalled();
    });

    it('should handle files that exceed the size limit', async () => {
      (fs.statSync as jest.Mock).mockReturnValue({ size: THIRTY_MB_IN_BYTES + 1 });

      const result = await uploadSourceMap(mockOptions);

      expect(result).toBe(false);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('exceeds the maximum allowed size')
      );
      expect(execSync).not.toHaveBeenCalled();
    });

    it('should handle curl execution errors', async () => {
      (execSync as jest.Mock).mockImplementation(() => {
        throw new Error('curl error');
      });

      const result = await uploadSourceMap(mockOptions);

      expect(result).toBe(false);
      expect(console.error).toHaveBeenCalled();
    });

    it('should handle gzipped payloads', async () => {
      await uploadSourceMap({
        ...mockOptions,
        gzipPayload: true
      });

      expect(execSync).toHaveBeenCalledWith(
        expect.stringContaining('Content-Encoding: gzip'),
        expect.any(Object)
      );
    });
  });

  describe('uploadCompressedSourceMaps', () => {
    const mockCompressedOptions: UploadCompressedSourceMapsOptions = {
      endpoint: mockEndpoint,
      appId: mockAppId,
      apiKey: mockApiKey,
      stackId: mockStackId,
      bundleId: mockBundleId,
      outputPath: mockOutputPath,
      files: [mockFilePath],
      keepSourcemaps: false,
      verbose: true
    };

    it('should upload compressed sourcemaps successfully', async () => {
      const result = await uploadCompressedSourceMaps(mockCompressedOptions);

      expect(result).toBe(true);
      expect(tar.create).toHaveBeenCalledWith(
        expect.objectContaining({ z: true }),
        expect.arrayContaining([mockFilePath])
      );
      expect(execSync).toHaveBeenCalledTimes(1);
    });

    it('should delete the sourcemap files if keepSourcemaps is false', async () => {
      await uploadCompressedSourceMaps(mockCompressedOptions);

      expect(fs.unlinkSync).toHaveBeenCalledWith(mockFilePath);
    });

    it('should not delete the sourcemap files if keepSourcemaps is true', async () => {
      await uploadCompressedSourceMaps({
        ...mockCompressedOptions,
        keepSourcemaps: true
      });

      // It should still delete the tarball
      expect(fs.unlinkSync).toHaveBeenCalledTimes(1);
      expect(fs.unlinkSync).not.toHaveBeenCalledWith(mockFilePath);
    });

    it('should handle oversized tarballs by splitting into chunks', async () => {
      // First check is for the tarball size
      (fs.statSync as jest.Mock).mockReturnValueOnce({ size: THIRTY_MB_IN_BYTES + 1 });
      // Second check is for the individual file size
      (fs.statSync as jest.Mock).mockReturnValueOnce({ size: 1024 * 1024 });

      const result = await uploadCompressedSourceMaps(mockCompressedOptions);

      expect(result).toBe(true);
      expect(fs.unlinkSync).toHaveBeenCalled(); // Should delete the oversized tarball
    });
  });

  describe('uploadSourceMaps', () => {
    // it('should upload multiple sourcemap files successfully', async () => {
    //   const result = await uploadSourceMaps(
    //     mockEndpoint,
    //     mockAppId,
    //     mockApiKey,
    //     mockStackId,
    //     mockBundleId,
    //     mockOutputPath
    //   );

    //   expect(result).toBe(true);
    //   expect(findMapFiles).toHaveBeenCalledWith(mockOutputPath);
    //   expect(execSync).toHaveBeenCalled();
    // });

    it('should handle no sourcemap files found', async () => {
      const result = await uploadSourceMaps(
        mockEndpoint,
        mockAppId,
        mockApiKey,
        mockStackId,
        mockBundleId,
        ''
      );

      expect(result).toBe(false);
    });

    it('should handle oversized files', async () => {
      (fs.statSync as jest.Mock).mockReturnValue({ size: THIRTY_MB_IN_BYTES + 1 });

      const result = await uploadSourceMaps(
        mockEndpoint,
        mockAppId,
        mockApiKey,
        mockStackId,
        mockBundleId,
        mockOutputPath
      );

      expect(result).toBe(false);
      expect(console.error).toHaveBeenCalled();
    });

    // it('should upload files as compressed tarball when gzipContents is true', async () => {
    //   const result = await uploadSourceMaps(
    //     mockEndpoint,
    //     mockAppId,
    //     mockApiKey,
    //     mockStackId,
    //     mockBundleId,
    //     mockOutputPath,
    //     { gzipContents: true }
    //   );

    //   expect(result).toBe(true);
    //   expect(tar.create).toHaveBeenCalled();
    // });
  });

  describe('generateCurlCommand', () => {
    it('should generate a curl command for uploading a sourcemap', () => {
      const command = generateCurlCommand(
        mockEndpoint,
        mockAppId,
        mockApiKey,
        mockStackId,
        mockBundleId,
        mockFilePath
      );

      expect(command).toContain('curl -X POST');
      expect(command).toContain(mockEndpoint);
      expect(command).toContain(mockAppId);
      expect(command).toContain(mockStackId);
      expect(command).toContain(mockApiKey);
      expect(command).toContain(mockFilePath);
    });

    it('should generate a curl command with gzip for uploading a sourcemap', () => {
      const command = generateCurlCommand(
        mockEndpoint,
        mockAppId,
        mockApiKey,
        mockStackId,
        mockBundleId,
        mockFilePath,
        true // gzipPayload
      );

      expect(command).toContain('gzip -c');
      expect(command).toContain('Content-Encoding: gzip');
    });

    it('should include a warning for oversized files', () => {
      (fs.statSync as jest.Mock).mockReturnValue({ size: THIRTY_MB_IN_BYTES + 1 });

      generateCurlCommand(
        mockEndpoint,
        mockAppId,
        mockApiKey,
        mockStackId,
        mockBundleId,
        mockFilePath
      );

      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('exceeds the maximum allowed size')
      );
    });
  });
});
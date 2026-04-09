import fs from 'fs';
import path from 'path';
import * as tar from 'tar';
import { execSync } from 'child_process';
import { gzipSync } from 'zlib';
import { tmpdir } from 'os';
import { consoleInfoOrange, THIRTY_MB_IN_BYTES, ensureSourceMapFileProperties } from '@grafana/faro-bundlers-shared';
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

  afterAll(() => {
    jest.resetAllMocks();

    jest.unmock('fs');
    jest.unmock('path');
    jest.unmock('tar');
    jest.unmock('child_process');
    jest.unmock('zlib');
    jest.unmock('os');
    jest.unmock('@grafana/faro-bundlers-shared');
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

    it('should call ensureSourceMapFileProperties before uploading', async () => {
      const makeDirent = (name: string) => ({
        name,
        isFile: () => true,
        isDirectory: () => false,
        isBlockDevice: () => false,
        isCharacterDevice: () => false,
        isSymbolicLink: () => false,
        isFIFO: () => false,
        isSocket: () => false,
        parentPath: mockOutputPath,
        path: mockOutputPath,
      });

      (fs.readdirSync as jest.Mock).mockReturnValue([
        makeDirent('a.js.map'),
      ]);
      jest.mocked(fs.statSync).mockReturnValue({ size: 1024 } as fs.Stats);

      await uploadSourceMaps(
        mockEndpoint,
        mockAppId,
        mockApiKey,
        mockStackId,
        mockBundleId,
        mockOutputPath,
        { verbose: true, recursive: true }
      );

      expect(ensureSourceMapFileProperties).toHaveBeenCalledWith(
        mockOutputPath,
        true,
        true
      );
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
  });

  describe('batched uploads', () => {
    const mockFiles = [
      '/mock/output/path/a.js.map',
      '/mock/output/path/b.js.map',
      '/mock/output/path/c.js.map',
      '/mock/output/path/d.js.map',
      '/mock/output/path/e.js.map',
    ];

    const makeDirent = (name: string, isFile: boolean) => ({
      name,
      isFile: () => isFile,
      isDirectory: () => !isFile,
      isBlockDevice: () => false,
      isCharacterDevice: () => false,
      isSymbolicLink: () => false,
      isFIFO: () => false,
      isSocket: () => false,
      parentPath: mockOutputPath,
      path: mockOutputPath,
    });

    const setupReaddirMock = (filenames: string[]) => {
      (fs.readdirSync as jest.Mock).mockReturnValue(
        filenames.map(name => makeDirent(name, true))
      );
    };

    it('should split files into batches by batchSize with gzipContents', async () => {
      setupReaddirMock(['a.js.map', 'b.js.map', 'c.js.map', 'd.js.map', 'e.js.map']);
      // Each file is 1MB — well under 30MB size limit, so only batchSize should cause splitting
      jest.mocked(fs.statSync).mockReturnValue({ size: 1024 * 1024 } as fs.Stats);

      const result = await uploadSourceMaps(
        mockEndpoint,
        mockAppId,
        mockApiKey,
        mockStackId,
        mockBundleId,
        mockOutputPath,
        { gzipContents: true, batchSize: 2, verbose: true }
      );

      expect(result).toBe(true);
      // 5 files with batchSize=2 → 3 batches (2, 2, 1), each creating a tarball
      expect(tar.create).toHaveBeenCalledTimes(3);
      expect(execSync).toHaveBeenCalledTimes(3);
    });

    it('should upload all files in a single batch when batchSize exceeds file count', async () => {
      setupReaddirMock(['a.js.map', 'b.js.map', 'c.js.map']);
      jest.mocked(fs.statSync).mockReturnValue({ size: 1024 * 1024 } as fs.Stats);

      const result = await uploadSourceMaps(
        mockEndpoint,
        mockAppId,
        mockApiKey,
        mockStackId,
        mockBundleId,
        mockOutputPath,
        { gzipContents: true, batchSize: 100, verbose: true }
      );

      expect(result).toBe(true);
      // All 3 files fit in one batch
      expect(tar.create).toHaveBeenCalledTimes(1);
      expect(execSync).toHaveBeenCalledTimes(1);
    });

    it('should split files into batches by maxUploadSize', async () => {
      setupReaddirMock(['a.js.map', 'b.js.map', 'c.js.map']);
      // Each file is 20MB — two files would exceed 30MB limit
      jest.mocked(fs.statSync).mockReturnValue({ size: 20 * 1024 * 1024 } as fs.Stats);

      const result = await uploadSourceMaps(
        mockEndpoint,
        mockAppId,
        mockApiKey,
        mockStackId,
        mockBundleId,
        mockOutputPath,
        { gzipContents: true, verbose: true }
      );

      expect(result).toBe(true);
      // 3 files at 20MB each, 30MB limit → batches of 1 file each
      expect(tar.create).toHaveBeenCalledTimes(3);
      expect(execSync).toHaveBeenCalledTimes(3);
    });

    it('should respect whichever limit is hit first: batchSize or maxUploadSize', async () => {
      setupReaddirMock(['a.js.map', 'b.js.map', 'c.js.map', 'd.js.map']);
      // Each file is 5MB — well under 30MB, but batchSize=1 should force one file per batch
      jest.mocked(fs.statSync).mockReturnValue({ size: 5 * 1024 * 1024 } as fs.Stats);

      const result = await uploadSourceMaps(
        mockEndpoint,
        mockAppId,
        mockApiKey,
        mockStackId,
        mockBundleId,
        mockOutputPath,
        { gzipContents: true, batchSize: 1, verbose: true }
      );

      expect(result).toBe(true);
      // batchSize=1 forces 4 batches even though size limit wouldn't require it
      expect(tar.create).toHaveBeenCalledTimes(4);
      expect(execSync).toHaveBeenCalledTimes(4);
    });

    it('should use batchSize for non-gzip chunked uploads (>10 files)', async () => {
      const manyFiles = Array.from({ length: 12 }, (_, i) => `file${i}.js.map`);
      setupReaddirMock(manyFiles);
      jest.mocked(fs.statSync).mockReturnValue({ size: 1024 } as fs.Stats);

      const result = await uploadSourceMaps(
        mockEndpoint,
        mockAppId,
        mockApiKey,
        mockStackId,
        mockBundleId,
        mockOutputPath,
        { gzipContents: false, batchSize: 5, verbose: true }
      );

      expect(result).toBe(true);
      // 12 files, batchSize=5, no gzip → individual uploads but chunked: 5+5+2 = 12 curl calls
      expect(execSync).toHaveBeenCalledTimes(12);
      // No tarballs created
      expect(tar.create).not.toHaveBeenCalled();
    });

    it('should work with batchSize on uploadCompressedSourceMaps fallback', async () => {
      // First call to statSync checks the tarball size — make it oversized to trigger chunking
      (fs.statSync as jest.Mock).mockReturnValueOnce({ size: THIRTY_MB_IN_BYTES + 1 });
      // Subsequent calls are for individual file sizes during chunking
      (fs.statSync as jest.Mock).mockReturnValue({ size: 1024 * 1024 } as fs.Stats);

      const result = await uploadCompressedSourceMaps({
        endpoint: mockEndpoint,
        appId: mockAppId,
        apiKey: mockApiKey,
        stackId: mockStackId,
        bundleId: mockBundleId,
        outputPath: mockOutputPath,
        files: mockFiles,
        keepSourcemaps: false,
        verbose: true,
        batchSize: 2,
      });

      expect(result).toBe(true);
      // Oversized tarball deleted, then falls back to chunked uploads
      expect(fs.unlinkSync).toHaveBeenCalled();
      // The initial oversized tarball + 3 chunk tarballs (2, 2, 1)
      expect(tar.create).toHaveBeenCalled();
    });
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
        THIRTY_MB_IN_BYTES, // maxUploadSize
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

    it('should upload a large file when maxUploadSize is set', () => {
      (fs.statSync as jest.Mock).mockReturnValue({ size: THIRTY_MB_IN_BYTES + 1 });

      const command = generateCurlCommand(
        mockEndpoint,
        mockAppId,
        mockApiKey,
        mockStackId,
        mockBundleId,
        mockFilePath,
        THIRTY_MB_IN_BYTES + 10,
        true
      );

      expect(command).toContain('gzip -c');
      expect(command).toContain('Content-Encoding: gzip');
    });
  });
});

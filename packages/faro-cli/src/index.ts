import fs from 'fs';
import path from 'path';
import { create } from 'tar';
import { execSync } from 'child_process';
import { consoleInfoOrange, THIRTY_MB_IN_BYTES, faroBundleIdSnippet } from '@grafana/faro-bundlers-shared';
import { gzipSync } from 'zlib';
import { tmpdir } from 'os';

export interface UploadSourceMapOptions {
  endpoint: string;
  appId: string;
  apiKey: string;
  stackId: string;
  bundleId: string;
  filePath: string;
  filename: string;
  keepSourcemaps: boolean;
  gzipPayload?: boolean;
  verbose?: boolean;
  maxUploadSize?: number;
  proxy?: string;
  proxyUser?: string;
}

export interface UploadCompressedSourceMapsOptions {
  endpoint: string;
  appId: string;
  apiKey: string;
  stackId: string;
  bundleId: string;
  outputPath: string;
  files: string[];
  keepSourcemaps: boolean;
  gzipPayload?: boolean;
  verbose?: boolean;
  maxUploadSize?: number;
  proxy?: string;
  proxyUser?: string;
}

/**
 * Options for injecting bundle ID into files
 */
export interface InjectBundleIdOptions {
  /** Enable verbose logging */
  verbose?: boolean;
  /** Only simulate the operation without making changes */
  dryRun?: boolean;
}

/**
 * Result of injecting bundle ID into a file
 */
export interface InjectBundleIdResult {
  /** Path to the file */
  file: string;
  /** Whether the file was modified */
  modified: boolean;
  /** Optional error message if the operation failed */
  error?: string;
}

/**
 * Creates a temporary gzipped version of a file
 * @param filePath Path to the file to gzip
 * @returns Path to the gzipped file
 */
const createGzippedFile = (filePath: string): string => {
  const fileContent = fs.readFileSync(filePath);
  const gzippedContent = gzipSync(fileContent);
  const tempFilePath = path.join(tmpdir(), `${path.basename(filePath)}.gz`);
  fs.writeFileSync(tempFilePath, gzippedContent);
  return tempFilePath;
};

/**
 * Checks if a file exceeds the maximum allowed size
 * @param filePath Path to the file to check
 * @param maxSize Optional custom max size in bytes (defaults to 30MB)
 * @returns boolean indicating if the file exceeds the size limit
 */
const exceedsMaxSize = (filePath: string, maxSize?: number): boolean => {
  const { size } = fs.statSync(filePath);
  const maxAllowedSize = maxSize && maxSize > 0 ? maxSize : THIRTY_MB_IN_BYTES;

  // The unzipped size must not exceed the max size, regardless of whether we're using gzip compression
  return size > maxAllowedSize;
};

/**
 * Executes a cURL command to upload a file
 * @param url The URL to upload to
 * @param filePath The path to the file to upload
 * @param headers Headers to include in the request
 * @param contentType Content type of the request
 * @param gzipPayload Whether to gzip the payload
 * @param maxUploadSize Optional custom max upload size in bytes
 * @param proxy Optional proxy URL to use for the request
 * @param proxyUser Optional username:password for proxy authentication
 * @returns Promise<boolean> indicating success or failure
 */
const executeCurl = (
  url: string,
  filePath: string,
  headers: Record<string, string>,
  contentType: string,
  gzipPayload: boolean = false,
  maxUploadSize?: number,
  proxy?: string,
  proxyUser?: string
): boolean => {
  try {
    let fileToUpload = filePath;
    let finalContentType = contentType;
    let tempFile: string | null = null;

    // Check file size before uploading
    if (exceedsMaxSize(filePath, maxUploadSize)) {
      console.error(`Error: File ${path.basename(filePath)} exceeds the maximum allowed size for upload.`);
      return false;
    }

    // If gzipping is requested and the file isn't already gzipped
    if (gzipPayload && !filePath.endsWith('.gz') && !contentType.includes('gzip')) {
      tempFile = createGzippedFile(filePath);
      fileToUpload = tempFile;
      finalContentType = 'application/gzip';
    }

    // Build headers string for curl command
    const headerArgs = Object.entries({
      ...headers,
      'Content-Type': finalContentType,
      ...(gzipPayload && !contentType.includes('gzip') ? { 'Content-Encoding': 'gzip' } : {})
    })
      .map(([key, value]) => `-H "${key}: ${value}"`)
      .join(' ');

    // Build the curl command
    const proxyArg = proxy ? `--proxy "${proxy}"` : '';
    const proxyUserArg = proxyUser ? `--proxy-user "${proxyUser}"` : '';
    const curlCommand = `curl -s -X POST ${proxyArg} ${proxyUserArg} "${url}" ${headerArgs} --data-binary @${fileToUpload}`;

    // Execute the curl command
    const result = execSync(curlCommand, { encoding: 'utf8' });

    // Clean up temporary file if created
    if (tempFile && fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }

    // Check if the response contains an error
    if (result && result.toLowerCase().includes('error')) {
      console.error(`Error in cURL response: ${result}`);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error executing cURL command:', error);
    return false;
  }
};

/**
 * Uploads a single sourcemap file to the Faro API using cURL
 * @param options Options for uploading the sourcemap
 * @returns Promise<boolean> indicating success or failure
 */
export const uploadSourceMap = async (
  options: UploadSourceMapOptions
): Promise<boolean> => {
  const {
    endpoint,
    appId,
    apiKey,
    stackId,
    bundleId,
    filePath,
    keepSourcemaps,
    gzipPayload,
    verbose,
    filename,
    maxUploadSize,
    proxy,
    proxyUser,
  } = options;

  const sourcemapEndpoint = `${endpoint}/app/${appId}/sourcemaps/${bundleId}`;
  let success = true;

  // Check file size before attempting to upload
  if (exceedsMaxSize(filePath, maxUploadSize)) {
    console.error(`Error: File ${filename} exceeds the maximum allowed size for upload.`);
    return false;
  }

  verbose && consoleInfoOrange(`Uploading ${filename} to ${sourcemapEndpoint}${gzipPayload ? ' (gzipped)' : ''}`);

  try {
    // Execute curl command to upload the file
    success = executeCurl(
      sourcemapEndpoint,
      filePath,
      { "Authorization": `Bearer ${stackId}:${apiKey}` },
      "application/json",
      gzipPayload,
      maxUploadSize,
      proxy,
      proxyUser
    );

    if (success) {
      verbose && consoleInfoOrange(`Uploaded ${filename} to ${sourcemapEndpoint}`);
    } else {
      consoleInfoOrange(`Upload of ${filename} failed`);
    }

    // delete source map if not keeping them
    if (!keepSourcemaps && fs.existsSync(filePath)) {
      verbose && consoleInfoOrange(`Deleting ${filename}`);
      fs.unlinkSync(filePath);
    }
  } catch (err) {
    console.error(err);
    success = false;
  }

  return success;
};

/**
* Uploads multiple sourcemap files a gzipped tarball to the Faro API using cURL
* @param options Options for uploading the sourcemaps
 * @returns Promise<boolean> indicating success or failure
 */
export const uploadCompressedSourceMaps = async (
  options: UploadCompressedSourceMapsOptions
): Promise<boolean> => {
  const {
    endpoint,
    appId,
    apiKey,
    stackId,
    bundleId,
    outputPath,
    files,
    keepSourcemaps,
    gzipPayload,
    verbose,
    maxUploadSize,
    proxy,
    proxyUser,
  } = options;

  const sourcemapEndpoint = `${endpoint}/app/${appId}/sourcemaps/${bundleId}`;
  let success = true;

  try {
    // Create a temporary tarball
    const tarball = path.join(outputPath, `${Date.now()}.tar.gz`);
    await create({ z: true, file: tarball }, files);

    // Check tarball size
    if (exceedsMaxSize(outputPath, maxUploadSize)) {
      verbose && consoleInfoOrange(`Tarball exceeds the maximum allowed size for upload. Splitting into smaller chunks.`);

      // Delete the oversized tarball
      fs.unlinkSync(tarball);

      // Split files into smaller chunks and upload each chunk
      return await uploadFilesInChunks(
        endpoint,
        appId,
        apiKey,
        stackId,
        bundleId,
        outputPath,
        files,
        keepSourcemaps,
        gzipPayload ?? false,
        verbose ?? false,
        false,
        maxUploadSize,
        proxy,
        proxyUser
      );
    }

    verbose &&
      consoleInfoOrange(
        `Uploading ${files
          .map((file) => path.basename(file))
          .join(", ")} to ${sourcemapEndpoint}${gzipPayload ? ' (with additional gzip compression)' : ''}`
      );

    // Execute curl command to upload the tarball
    // Note: tarball is already gzipped, so we don't need to gzip it again
    success = executeCurl(
      sourcemapEndpoint,
      tarball,
      { "Authorization": `Bearer ${stackId}:${apiKey}` },
      "application/gzip",
      false, // Don't gzip again as tarball is already compressed
      maxUploadSize,
      proxy,
      proxyUser
    );

    if (success) {
      verbose &&
        consoleInfoOrange(
          `Uploaded ${files
            .map((file) => path.basename(file))
            .join(", ")} to ${sourcemapEndpoint}`
        );
    } else {
      consoleInfoOrange(
        `Upload of ${files
          .map((file) => path.basename(file))
          .join(", ")} failed`
      );
    }

    // delete tarball
    if (fs.existsSync(tarball)) {
      fs.unlinkSync(tarball);
    }

    // delete source maps if not keeping them
    if (!keepSourcemaps) {
      verbose &&
        consoleInfoOrange(
          `Deleting ${files.map((file) => path.basename(file)).join(", ")}`
        );
      for (let filePath of files) {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }
    }
  } catch (err) {
    console.error(err);
    success = false;
  }

  return success;
};

/**
 * Uploads files in smaller chunks to avoid exceeding the 30MB limit
 * @param endpoint The Faro API endpoint
 * @param appId The app ID
 * @param apiKey The API key
 * @param stackId The stack ID
 * @param bundleId The bundle ID
 * @param outputPath The output path
 * @param files The files to upload
 * @param keepSourcemaps Whether to keep sourcemaps after uploading
 * @param gzipContents Whether to compress sourcemaps as a tarball before uploading
 * @param gzipPayload Whether to gzip the payload
 * @param verbose Whether to log verbose output
 * @param maxUploadSize Optional custom max upload size in bytes
 * @returns Promise<boolean> indicating success or failure
 */
const uploadFilesInChunks = async (
  endpoint: string,
  appId: string,
  apiKey: string,
  stackId: string,
  bundleId: string,
  outputPath: string,
  files: string[],
  keepSourcemaps: boolean,
  gzipPayload: boolean,
  verbose: boolean,
  gzipContents: boolean = false,
  maxUploadSize?: number,
  proxy?: string,
  proxyUser?: string
): Promise<boolean> => {
  // Split files into chunks based on size
  const chunks: string[][] = [];
  let currentChunk: string[] = [];
  let currentSize = 0;

  // Get file sizes
  const filesWithSize = files.map(file => ({
    path: file,
    size: fs.statSync(file).size
  })).sort((a, b) => b.size - a.size);

  const maxSize = maxUploadSize && maxUploadSize > 0 ? maxUploadSize : THIRTY_MB_IN_BYTES;

  // Filter out files that are too large
  const oversizedFiles = filesWithSize.filter(file => file.size > maxSize);
  if (oversizedFiles.length) {
    oversizedFiles.forEach(file => {
      console.error(`Error: File ${path.basename(file.path)} exceeds the maximum allowed size of ${maxSize} bytes for upload.`);
    });
  }

  const validFiles = filesWithSize.filter(file => file.size <= maxSize);
  if (validFiles.length === 0) {
    return false;
  }

  // Create chunks of files that fit within the size limit
  for (const file of validFiles) {
    // If adding this file would exceed the limit, start a new chunk
    if (currentSize + file.size > maxSize) {
      currentChunk = [];
      chunks.push(currentChunk);
      currentSize = 0;
    }

    currentChunk.push(file.path);
    currentSize += file.size;

    if (chunks.length === 0) {
      chunks.push(currentChunk);
    }
  }

  verbose && consoleInfoOrange(`Split ${files.length} files into ${chunks.length} chunks for upload`);

  // Upload each chunk
  let allSucceeded = true;
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (chunk.length === 0) continue;

    verbose && consoleInfoOrange(`Uploading chunk ${i + 1}/${chunks.length} (${chunk.length} files)`);

    let result: boolean;

    if (gzipContents) {
      // Upload as compressed tarball
      result = await uploadCompressedSourceMaps({
        endpoint,
        appId,
        apiKey,
        stackId,
        bundleId,
        outputPath,
        files: chunk,
        keepSourcemaps: i < chunks.length - 1 ? true : keepSourcemaps, // Only delete files after the last chunk is uploaded
        gzipPayload,
        verbose,
        maxUploadSize,
        proxy,
        proxyUser,
      });
    } else {
      // Upload files individually
      let chunkSuccess = true;
      for (const file of chunk) {
        const fileResult = await uploadSourceMap({
          endpoint,
          appId,
          apiKey,
          stackId,
          bundleId,
          filePath: file,
          filename: path.basename(file),
          keepSourcemaps: i < chunks.length - 1 ? true : keepSourcemaps, // Only delete files after the last chunk is uploaded
          gzipPayload,
          verbose,
          maxUploadSize,
          proxy,
          proxyUser,
        });

        if (!fileResult) {
          chunkSuccess = false;
        }
      }
      result = chunkSuccess;
    }

    if (!result) {
      allSucceeded = false;
      console.error(`Failed to upload chunk ${i + 1}/${chunks.length}`);
    }
  }

  return allSucceeded;
};

/**
 * Generates a cURL command for uploading a sourcemap file
 * @param endpoint The Faro API endpoint
 * @param appId The app ID
 * @param apiKey The API key
 * @param stackId The stack ID
 * @param bundleId The bundle ID
 * @param filePath The path to the sourcemap file
 * @param maxUploadSize Maximum upload size in bytes
 * @param gzipPayload Whether to gzip the payload
 * @param proxy Optional proxy URL to use for the request
 * @param proxyUser Optional username:password for proxy authentication
 * @returns string The cURL command
 */
export const generateCurlCommand = (
  endpoint: string,
  appId: string,
  apiKey: string,
  stackId: string,
  bundleId: string,
  filePath: string,
  maxUploadSize: number = THIRTY_MB_IN_BYTES,
  gzipPayload: boolean = false,
  proxy?: string,
  proxyUser?: string
): string => {
  const sourcemapEndpoint = `${endpoint}/app/${appId}/sourcemaps/${bundleId}`;

  // Check file size and warn if it exceeds the limit
  if (exceedsMaxSize(filePath, maxUploadSize)) {
    console.warn(`Warning: File ${path.basename(filePath)} exceeds the maximum allowed size of ${maxUploadSize} bytes for upload.`);
  }

  const proxyArg = proxy ? `--proxy "${proxy}"` : '';
  const proxyUserArg = proxyUser ? `--proxy-user "${proxyUser}"` : '';

  if (gzipPayload) {
    return `# This command gzips the file content before uploading
cat ${filePath} | gzip -c | curl -X POST ${proxyArg} ${proxyUserArg} "${sourcemapEndpoint}" \\
  -H "Content-Type: application/json" \\
  -H "Content-Encoding: gzip" \\
  -H "Authorization: Bearer ${stackId}:${apiKey}" \\
  --data-binary @-`;
  } else {
    return `curl -X POST ${proxyArg} ${proxyUserArg} "${sourcemapEndpoint}" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${stackId}:${apiKey}" \\
  --data-binary @${filePath}`;
  }
};


/**
 * Recursively finds all .map files in a directory
 * @param dir The directory to search
 * @param recursive Whether to search subdirectories
 * @returns An array of paths to all .map files in the directory and its subdirectories
 */
export const findMapFiles = (dir: string, recursive: boolean = false): string[] => {
  const sourcemapFiles: string[] = [];
  const files = fs.readdirSync(dir, { recursive });

  for (const file of files) {
    const filePath = path.join(dir, file.toString());
    const stat = fs.statSync(filePath);

    if (stat.isFile() && file.toString().endsWith('.map')) {
      sourcemapFiles.push(filePath);
    }
  }

  return sourcemapFiles;
};

/**
 * Uploads sourcemaps to the Faro API using cURL
 * @param endpoint The Faro API endpoint
 * @param appId The app ID
 * @param apiKey The API key
 * @param stackId The stack ID
 * @param bundleId The bundle ID
 * @param outputPath The output path containing sourcemap files
 * @param options Options for uploading the sourcemaps
 * @returns Promise<boolean> indicating success or failure
 */
export const uploadSourceMaps = async (
  endpoint: string,
  appId: string,
  apiKey: string,
  stackId: string,
  bundleId: string,
  outputPath: string,
  options: {
    keepSourcemaps?: boolean;
    gzipContents?: boolean;
    gzipPayload?: boolean;
    verbose?: boolean;
    maxUploadSize?: number;
    recursive?: boolean;
    proxy?: string;
    proxyUser?: string;
  } = {}
): Promise<boolean> => {
  const {
    keepSourcemaps = false,
    gzipContents = false,
    gzipPayload = false,
    verbose = false,
    maxUploadSize,
    recursive = false,
    proxy,
    proxyUser,
  } = options;

  const maxSize = maxUploadSize && maxUploadSize > 0 ? maxUploadSize : THIRTY_MB_IN_BYTES;

  try {
    // Find all .map files in the output directory
    const sourcemapFiles = findMapFiles(outputPath, recursive);
    if (sourcemapFiles.length === 0) {
      console.error(`Error: No sourcemap files found in ${outputPath}`);
      return false;
    }

    verbose && consoleInfoOrange(`Found ${sourcemapFiles.length} sourcemap files in ${outputPath}`);

    // Check for oversized files first
    const oversizedFiles: string[] = [];
    for (const file of sourcemapFiles) {
      if (exceedsMaxSize(file, maxUploadSize)) {
        const size = fs.statSync(file).size;
        oversizedFiles.push(file);
        console.error(`Error: File ${path.basename(file)} exceeds the maximum allowed size of ${maxSize} bytes (${(size / (1024 * 1024)).toFixed(2)}MB)`);
      }
    }

    // Filter out oversized files
    const validFiles = sourcemapFiles.filter(file => !exceedsMaxSize(file, maxUploadSize));
    if (validFiles.length === 0) {
      return false;
    }

    // If we're gzipping the contents, upload all files at once
    if (gzipContents) {
      verbose && consoleInfoOrange(`Compressing ${validFiles.length} sourcemap files as a tarball`);

      // Create a temporary directory for the tarball
      const tempDir = fs.mkdtempSync(path.join(tmpdir(), 'faro-'));
      const tarball = path.join(tempDir, `${bundleId}.tar.gz`);

      // Create the tarball
      await create({ z: true, file: tarball }, validFiles);

      // Check tarball size
      if (exceedsMaxSize(tarball, maxUploadSize)) {
        verbose && consoleInfoOrange(`Tarball exceeds ${maxSize} byte limit. Splitting into smaller chunks.`);

        // Delete the tarball
        fs.unlinkSync(tarball);

        // Upload files in chunks
        return uploadFilesInChunks(
          endpoint,
          appId,
          apiKey,
          stackId,
          bundleId,
          outputPath,
          validFiles,
          keepSourcemaps,
          gzipPayload,
          verbose,
          false,
          maxUploadSize,
          proxy,
          proxyUser
        );
      }

      // Upload the tarball
      const sourcemapEndpoint = `${endpoint}/app/${appId}/sourcemaps/${bundleId}`;
      const result = executeCurl(
        sourcemapEndpoint,
        tarball,
        { "Authorization": `Bearer ${stackId}:${apiKey}` },
        "application/gzip",
        false, // Don't gzip again as tarball is already compressed
        maxUploadSize,
        proxy,
        proxyUser
      );

      // Delete the tarball
      fs.unlinkSync(tarball);
      fs.rmdirSync(tempDir);

      // Delete the sourcemaps if requested
      if (!keepSourcemaps && result) {
        verbose && consoleInfoOrange(`Deleting ${validFiles.length} sourcemap files`);
        for (const file of validFiles) {
          fs.unlinkSync(file);
        }
      }

      return result;
    }

    // If we're not gzipping the contents, upload files individually or in chunks
    if (validFiles.length > 10) {
      verbose && consoleInfoOrange(`Uploading ${validFiles.length} sourcemap files in chunks`);
      return uploadFilesInChunks(
        endpoint,
        appId,
        apiKey,
        stackId,
        bundleId,
        outputPath,
        validFiles,
        keepSourcemaps,
        gzipPayload,
        verbose,
        false,
        maxUploadSize,
        proxy,
        proxyUser
      );
    }

    // Upload files individually
    verbose && consoleInfoOrange(`Uploading ${validFiles.length} sourcemap files individually`);
    let success = true;

    // If we have fewer than 10 files, upload them individually
    for (const file of validFiles) {
      const result = await uploadSourceMap({
        endpoint,
        appId,
        apiKey,
        stackId,
        bundleId,
        filePath: file,
        filename: path.basename(file),
        keepSourcemaps,
        gzipPayload,
        verbose,
        maxUploadSize,
        proxy,
        proxyUser,
      });

      if (!result) {
        success = false;
      }
    }

    return success;
  } catch (err) {
    console.error('Error:', err);
    return false;
  }
};

/**
 * Injects bundle ID snippet into JavaScript files
 * @param bundleId Bundle ID to inject
 * @param appName Application name used in the bundle ID snippet
 * @param files Array of file paths to modify
 * @param options Additional options
 * @returns Array of results for each file
 */
export const injectBundleId = async (
  bundleId: string,
  appName: string,
  files: string[],
  options: InjectBundleIdOptions = {}
): Promise<InjectBundleIdResult[]> => {
  const { verbose = false, dryRun = false } = options;
  const results: InjectBundleIdResult[] = [];
  const snippet = faroBundleIdSnippet(bundleId, appName);

  for (const file of files) {
    try {
      // Check if file exists and is a regular file
      const stat = await fs.promises.stat(file);
      if (!stat.isFile()) {
        results.push({
          file,
          modified: false,
          error: 'Not a regular file'
        });
        continue;
      }

      // Read file content
      let content = await fs.promises.readFile(file, 'utf8');

      // Check if bundle ID snippet is already present
      if (content.includes(`__faroBundleId_${appName}`)) {
        verbose && consoleInfoOrange(`Skipping ${file} - bundle ID snippet already present`);
        results.push({
          file,
          modified: false
        });
        continue;
      }

      // Inject bundle ID snippet at the beginning of the file
      const modifiedContent = snippet + content;

      // Write modified content back to file
      if (!dryRun) {
        await fs.promises.writeFile(file, modifiedContent);
      }

      verbose && consoleInfoOrange(`${dryRun ? 'Would modify' : 'Modified'}: ${file}`);
      results.push({
        file,
        modified: true
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      verbose && console.error(`Error processing ${file}: ${errorMessage}`);
      results.push({
        file,
        modified: false,
        error: errorMessage
      });
    }
  }

  return results;
};
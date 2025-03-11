import fs from 'fs';
import path from 'path';
import { create } from 'tar';
import { execSync } from 'child_process';
import { consoleInfoOrange, THIRTY_MB_IN_BYTES } from '@grafana/faro-bundlers-shared';
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
 * @returns boolean indicating if the file exceeds the size limit
 */
const exceedsMaxSize = (filePath: string): boolean => {
  const { size } = fs.statSync(filePath);

  // The unzipped size must not exceed 30MB, regardless of whether we're using gzip compression
  return size > THIRTY_MB_IN_BYTES;
};

/**
 * Executes a cURL command to upload a file
 * @param url The URL to upload to
 * @param filePath The path to the file to upload
 * @param headers Headers to include in the request
 * @param contentType Content type of the request
 * @param gzipPayload Whether to gzip the payload
 * @returns Promise<boolean> indicating success or failure
 */
const executeCurl = (
  url: string,
  filePath: string,
  headers: Record<string, string>,
  contentType: string,
  gzipPayload: boolean = false
): boolean => {
  try {
    let fileToUpload = filePath;
    let finalContentType = contentType;
    let tempFile: string | null = null;

    // Check file size before uploading
    if (exceedsMaxSize(filePath)) {
      console.error(`Error: File ${path.basename(filePath)} exceeds the maximum allowed size of 30MB for upload.`);
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
    const curlCommand = `curl -s -X POST ${headerArgs} --data-binary @${fileToUpload} "${url}"`;

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
  } = options;

  const sourcemapEndpoint = `${endpoint}/app/${appId}/sourcemaps/${bundleId}`;
  let success = true;

  // Check file size before attempting to upload
  if (exceedsMaxSize(filePath)) {
    console.error(`Error: File ${filename} exceeds the maximum allowed size of 30MB for upload.`);
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
      gzipPayload
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
 * Uploads multiple sourcemap files compressed as a tarball to the Faro API using cURL
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
    verbose
  } = options;

  const sourcemapEndpoint = `${endpoint}/app/${appId}/sourcemaps/${bundleId}`;
  let success = true;

  try {
    // Create a temporary tarball
    const tarball = path.join(outputPath, `${Date.now()}.tar.gz`);
    await create({ z: true, file: tarball }, files);

    // Check tarball size
    if (exceedsMaxSize(outputPath)) {
      verbose && consoleInfoOrange(`Tarball exceeds 30MB limit. Splitting into smaller chunks.`);

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
        verbose ?? false
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
      false // Don't gzip again as tarball is already compressed
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
  gzipContents: boolean = false
): Promise<boolean> => {
  // Split files into chunks based on size
  const chunks: string[][] = [[]];
  let currentChunk = 0;
  let currentSize = 0;

  // Sort files by size (largest first) to optimize chunking
  const filesWithSize = files.map(file => ({
    path: file,
    size: fs.statSync(file).size
  })).sort((a, b) => b.size - a.size);

  // Check if any individual file exceeds the limit
  const oversizedFiles = filesWithSize.filter(file => file.size > THIRTY_MB_IN_BYTES);
  if (oversizedFiles.length > 0) {
    console.error(`Error: The following files exceed the 30MB limit and cannot be uploaded:`);
    oversizedFiles.forEach(file => {
      console.error(`- ${path.basename(file.path)} (${(file.size / (1024 * 1024)).toFixed(2)}MB)`);
    });

    // Filter out oversized files
    const validFiles = filesWithSize.filter(file => file.size <= THIRTY_MB_IN_BYTES);
    if (validFiles.length === 0) {
      return false;
    }

    // Continue with valid files
    filesWithSize.length = 0;
    filesWithSize.push(...validFiles);
  }

  // Create chunks of files that fit within the 30MB limit
  for (const file of filesWithSize) {
    // If adding this file would exceed the limit, start a new chunk
    if (currentSize + file.size > THIRTY_MB_IN_BYTES) {
      currentChunk++;
      chunks[currentChunk] = [];
      currentSize = 0;
    }

    chunks[currentChunk].push(file.path);
    currentSize += file.size;
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
 * @param gzipPayload Whether to gzip the payload
 * @returns string The cURL command
 */
export const generateCurlCommand = (
  endpoint: string,
  appId: string,
  apiKey: string,
  stackId: string,
  bundleId: string,
  filePath: string,
  gzipPayload: boolean = false
): string => {
  const sourcemapEndpoint = `${endpoint}/app/${appId}/sourcemaps/${bundleId}`;

  // Check file size and warn if it exceeds the limit
  if (exceedsMaxSize(filePath)) {
    console.warn(`Warning: File ${path.basename(filePath)} exceeds the maximum allowed size of 30MB for upload.`);
  }

  if (gzipPayload) {
    return `# This command gzips the file content before uploading
cat ${filePath} | gzip -c | curl -X POST "${sourcemapEndpoint}" \\
  -H "Content-Type: application/json" \\
  -H "Content-Encoding: gzip" \\
  -H "Authorization: Bearer ${stackId}:${apiKey}" \\
  --data-binary @-`;
  } else {
    return `curl -X POST "${sourcemapEndpoint}" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${stackId}:${apiKey}" \\
  --data-binary @${filePath}`;
  }
};


/**
 * Recursively finds all .map files in a directory
 * @param dir The directory to search
 * @returns An array of paths to all .map files in the directory and its subdirectories
 */
export const findMapFiles = (dir: string): string[] => {
  const sourcemapFiles: string[] = [];
  const files = fs.readdirSync(dir);

  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      // Recursively search subdirectories
      findMapFiles(filePath);
    } else if (stat.isFile() && file.endsWith('.map')) {
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
  } = {}
): Promise<boolean> => {
  const {
    keepSourcemaps = false,
    gzipContents = false,
    gzipPayload = false,
    verbose = false
  } = options;

  try {
    // Find all .map files in the output path
    const sourcemapFiles = findMapFiles(outputPath);

    if (sourcemapFiles.length === 0) {
      consoleInfoOrange('No sourcemap files found');
      return false;
    }

    verbose && consoleInfoOrange(`Found ${sourcemapFiles.length} sourcemap files`);

    // Process files in a streaming fashion, similar to bundler plugins
    const sourcemapEndpoint = `${endpoint}/app/${appId}/sourcemaps/${bundleId}`;
    const filesToUpload: string[] = [];
    let totalSize = 0;
    let allSucceeded = true;
    const uploadedSourcemaps: string[] = [];
    const oversizedFiles: string[] = [];

    // Check for oversized files first
    for (const file of sourcemapFiles) {
      if (exceedsMaxSize(file)) {
        const size = fs.statSync(file).size;
        oversizedFiles.push(file);
        console.error(`- ${path.basename(file)} (${(size / (1024 * 1024)).toFixed(2)}MB)`);
      }
    }

    if (oversizedFiles.length > 0) {
      console.error(`Error: The following files exceed the 30MB limit and cannot be uploaded:`);
      oversizedFiles.forEach(file => {
        const size = fs.statSync(file).size;
        console.error(`- ${path.basename(file)} (${(size / (1024 * 1024)).toFixed(2)}MB)`);
      });
    }

    // Filter out oversized files
    const validFiles = sourcemapFiles.filter(file => !exceedsMaxSize(file));
    if (validFiles.length === 0) {
      return false;
    }

    // Process valid files
    for (const file of validFiles) {
      if (fs.existsSync(file)) {
        const { size } = fs.statSync(file);

        filesToUpload.push(file);
        totalSize += size;

        // If we've accumulated enough files or this is the last file, upload the batch
        if (totalSize > THIRTY_MB_IN_BYTES || file === validFiles[validFiles.length - 1]) {
          // If we've exceeded the limit, remove the last file for the next batch
          // (unless this is the last file, in which case we need to upload it anyway)
          if (totalSize > THIRTY_MB_IN_BYTES && file !== validFiles[validFiles.length - 1]) {
            filesToUpload.pop();
            totalSize -= size;
          }

          let result: boolean;
          if (gzipContents) {
            // Upload as compressed tarball
            result = await uploadCompressedSourceMaps({
              endpoint: sourcemapEndpoint,
              appId,
              apiKey,
              stackId,
              bundleId,
              outputPath,
              files: filesToUpload,
              keepSourcemaps: file !== validFiles[validFiles.length - 1] ? true : keepSourcemaps, // Only delete files after the last batch
              gzipPayload,
              verbose,
            });
          } else {
            // Upload files individually
            let batchSuccess = true;
            for (const batchFile of filesToUpload) {
              const fileResult = await uploadSourceMap({
                endpoint: sourcemapEndpoint,
                appId,
                apiKey,
                stackId,
                bundleId,
                filePath: batchFile,
                filename: path.basename(batchFile),
                keepSourcemaps: file !== validFiles[validFiles.length - 1] ? true : keepSourcemaps, // Only delete files after the last batch
                gzipPayload,
                verbose,
              });

              if (!fileResult) {
                batchSuccess = false;
              }
            }
            result = batchSuccess;
          }

          if (result) {
            uploadedSourcemaps.push(...filesToUpload);
          } else {
            allSucceeded = false;
          }

          // Reset for next batch
          filesToUpload.length = 0;

          // If this was the last file and we removed it earlier, add it back for the next batch
          if (totalSize > THIRTY_MB_IN_BYTES && file !== validFiles[validFiles.length - 1]) {
            filesToUpload.push(file);
            totalSize = size;
          } else {
            totalSize = 0;
          }
        }
      }
    }

    verbose && consoleInfoOrange(`Successfully uploaded ${uploadedSourcemaps.length} sourcemap files`);
    return allSucceeded;
  } catch (err) {
    console.error(err);
    return false;
  }
};
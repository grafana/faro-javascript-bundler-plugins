import { Plugin, OutputOptions, OutputBundle } from "rollup";
import MagicString from "magic-string";
import {
  ROLLUP_PLUGIN_NAME,
  FaroSourceMapUploaderPluginOptions,
  faroBundleIdSnippet,
  randomString,
  consoleInfoOrange,
  uploadSourceMap,
  uploadCompressedSourceMaps,
  THIRTY_MB_IN_BYTES,
  exportBundleIdToFile,
  shouldProcessFile,
} from "@grafana/faro-bundlers-shared";

import fs from "fs";

export default function faroUploader(
  pluginOptions: FaroSourceMapUploaderPluginOptions
): Plugin {
  const {
    endpoint,
    appId,
    apiKey,
    stackId,
    appName,
    outputFiles,
    keepSourcemaps,
    gzipContents,
    verbose,
    skipUpload,
  } = pluginOptions;
  const bundleId =
    pluginOptions.bundleId ?? String(Date.now() + randomString(5));
  const uploadEndpoint = `${endpoint}/app/${appId}/sourcemaps/`;
  const maxSize = pluginOptions.maxUploadSize && pluginOptions.maxUploadSize > 0
    ? pluginOptions.maxUploadSize
    : THIRTY_MB_IN_BYTES;

  // Export bundleId to environment variable if skipUpload is true
  if (skipUpload) {
    exportBundleIdToFile(bundleId, appName, verbose);
  }

  return {
    name: ROLLUP_PLUGIN_NAME,
    /**
     * Renders a chunk of code and generates a source map with a bundleId code snippet injected at the end.
     * @param code The original code of the chunk.
     * @param chunk The chunk object containing information about the file.
     * @returns An object with the rendered code and the generated source map, or null if the chunk's file extension does not match the patterns.
     */
    renderChunk(code, chunk) {
      if (chunk.fileName.match(/\.(js|ts|jsx|tsx|mjs|cjs)$/)) {
        const newCode = new MagicString(code);

        newCode.prepend(faroBundleIdSnippet(bundleId, appName));

        const map = newCode.generateMap({
          source: chunk.fileName,
          file: `${chunk.fileName}.map`,
        });

        return {
          code: newCode.toString(),
          map,
        };
      }

      return null;
    },
    async writeBundle(options: OutputOptions, bundle: OutputBundle) {
      // Skip uploading if skipUpload is true
      if (skipUpload) {
        verbose && consoleInfoOrange(`Skipping sourcemap upload as skipUpload is set to true`);
        return;
      }

      const uploadedSourcemaps = [];

      try {
        const outputPath = options.dir!;
        const sourcemapEndpoint = uploadEndpoint + bundleId;
        const filesToUpload = [];
        let totalSize = 0;

        for (let filename in bundle) {
          // Only include JavaScript-related source maps or match the outputFiles regex
          if (!shouldProcessFile(filename, outputFiles)) {
            continue;
          }

          // if we are tar/gzipping contents, collect N files and upload them all at once
          // total size of all files uploaded at once must be less than the configured max size (uncompressed)
          if (gzipContents) {
            const file = `${outputPath}/${filename}`;
            const { size } = fs.statSync(file);

            filesToUpload.push(file);
            totalSize += size;

            if (totalSize > maxSize) {
              filesToUpload.pop();
              const result = await uploadCompressedSourceMaps({
                sourcemapEndpoint,
                apiKey,
                stackId,
                outputPath,
                files: filesToUpload,
                keepSourcemaps: !!keepSourcemaps,
                verbose: verbose,
              });

              if (result) {
                uploadedSourcemaps.push(...filesToUpload);
              }

              filesToUpload.length = 0;
              filesToUpload.push(file);
              totalSize = size;
            }
          }

          // if we are not compressing, upload each file individually
          if (!gzipContents) {
            const result = await uploadSourceMap({
              sourcemapEndpoint,
              apiKey,
              stackId,
              filename,
              filePath: `${outputPath}/${filename}`,
              keepSourcemaps: !!keepSourcemaps,
              verbose: verbose,
            });

            if (result) {
              uploadedSourcemaps.push(filename);
            }
          }
        }

        // upload any remaining files
        if (filesToUpload.length) {
          const result = await uploadCompressedSourceMaps({
            sourcemapEndpoint,
            apiKey,
            stackId,
            outputPath,
            files: filesToUpload,
            keepSourcemaps: !!keepSourcemaps,
            verbose: verbose,
          });

          if (result) {
            uploadedSourcemaps.push(...filesToUpload);
          }
        }
      } catch (e) {
        console.error(e);
      }

      if (verbose) {
        consoleInfoOrange(
          uploadedSourcemaps.length
            ? `Uploaded sourcemaps: ${uploadedSourcemaps.map(map => map.split('/').pop()).join(", ")}`
            : "No sourcemaps uploaded"
        );
      }
    },
  };
}

module.exports = faroUploader;

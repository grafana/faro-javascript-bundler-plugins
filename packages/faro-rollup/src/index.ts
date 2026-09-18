import type { Plugin, OutputOptions, OutputBundle } from "rollup";
import MagicString from "magic-string";
import {
  ROLLUP_PLUGIN_NAME,
  FaroSourceMapUploaderPluginOptions,
  faroBundleIdSnippet,
  faroGitHashSnippet,
  resolveGitHash,
  randomString,
  consoleInfoOrange,
  uploadCompressedSourceMaps,
  uploadIndividualSourceMaps,
  THIRTY_MB_IN_BYTES,
  exportBundleIdToFile,
  shouldProcessFile,
  modifySourceMapFileProperty,
  findSourceMapFiles,
} from "@grafana/faro-bundlers-shared";

import fs from "fs";
import path from "path";

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
    proxy,
    prefixPath,
    prefixPathBasenameOnly,
    uploadConcurrency,
  } = pluginOptions;
  const bundleId =
    pluginOptions.bundleId ?? String(Date.now() + randomString(5));
  const uploadEndpoint = `${endpoint}/app/${appId}/sourcemaps/`;
  const maxSize = pluginOptions.maxUploadSize && pluginOptions.maxUploadSize > 0
    ? pluginOptions.maxUploadSize
    : THIRTY_MB_IN_BYTES;
  const gitHash = resolveGitHash(pluginOptions.gitHash);
  if (!gitHash) {
    consoleInfoOrange(`Git hash could not be resolved. window.__faroGitHash_${appName} will not be injected.`);
  }

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

        newCode.prepend((gitHash ? faroGitHashSnippet(gitHash, appName) : '') + faroBundleIdSnippet(bundleId, appName));

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
      // handle both dir and file output modes
      const outputPath = options.dir || (options.file ? path.dirname(options.file) : process.cwd());

      // modify source map file properties if prefixPath is provided (do this regardless of skipUpload)
      // NOTE: we scan the output directory directly rather than iterating the bundle object because
      // Vite (and some Rollup configurations) write source maps to subdirectories (e.g. assets/)
      // and those files may not appear as separate entries in the OutputBundle.
      if (prefixPath) {
        try {
          const sourceMapFiles = findSourceMapFiles(outputPath, outputFiles, true);
          for (const { filePath } of sourceMapFiles) {
            modifySourceMapFileProperty(filePath, prefixPath, verbose, prefixPathBasenameOnly);
          }
        } catch (e) {
          console.error('Error modifying source maps:', e);
        }
      }

      // Skip uploading if skipUpload is true
      if (skipUpload) {
        verbose && consoleInfoOrange(`Skipping sourcemap upload as skipUpload is set to true`);
        return;
      }

      const uploadedSourcemaps = [];

      try {
        const sourcemapEndpoint = uploadEndpoint + bundleId;
        const filesToUpload = [];
        let totalSize = 0;
        const sourceMapFiles = Object.keys(bundle)
          .filter((filename) => shouldProcessFile(filename, outputFiles))
          .map((filename) => ({
            filename,
            filePath: path.join(outputPath, filename),
          }));

        if (!gzipContents) {
          uploadedSourcemaps.push(
            ...(await uploadIndividualSourceMaps({
              sourcemapEndpoint,
              apiKey,
              stackId,
              files: sourceMapFiles,
              keepSourcemaps: !!keepSourcemaps,
              verbose: verbose,
              proxy: proxy,
              uploadConcurrency,
            }))
          );
        }

        if (gzipContents) {
          for (const { filePath } of sourceMapFiles) {
            // if we are tar/gzipping contents, collect N files and upload them all at once
            // total size of all files uploaded at once must be less than the configured max size (uncompressed)
            const { size } = fs.statSync(filePath);

            filesToUpload.push(filePath);
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
                proxy: proxy,
              });

              if (result) {
                uploadedSourcemaps.push(...filesToUpload);
              }

              filesToUpload.length = 0;
              filesToUpload.push(filePath);
              totalSize = size;
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
            proxy: proxy,
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

import * as esbuild from "esbuild";
import fs from "fs";
import path from "path";
import {
  ESBUILD_PLUGIN_NAME,
  FaroSourceMapUploaderPluginOptions,
  faroBundleIdSnippet,
  randomString,
  consoleInfoOrange,
  uploadSourceMap,
  uploadCompressedSourceMaps,
  THIRTY_MB_IN_BYTES,
  exportBundleIdToFile,
  shouldProcessFile,
  modifySourceMapFileProperty,
  ensureSourceMapFileProperty,
} from "@grafana/faro-bundlers-shared";

export default function faroEsbuildPlugin(
  pluginOptions: FaroSourceMapUploaderPluginOptions
): esbuild.Plugin {
  const {
    endpoint,
    appId,
    apiKey,
    stackId,
    appName,
    outputPath,
    outputFiles,
    keepSourcemaps,
    gzipContents,
    verbose,
    skipUpload,
    maxUploadSize,
    recursive,
    proxy,
    prefixPath,
  } = pluginOptions;
  const bundleId =
    pluginOptions.bundleId ?? String(Date.now() + randomString(5));
  const uploadEndpoint = `${endpoint}/app/${appId}/sourcemaps/`;
  const maxSize =
    maxUploadSize && maxUploadSize > 0 ? maxUploadSize : THIRTY_MB_IN_BYTES;

  // export bundleId to environment variable if skipUpload is true
  if (skipUpload) {
    exportBundleIdToFile(bundleId, appName, verbose);
  }

  return {
    name: ESBUILD_PLUGIN_NAME,
    setup(build) {
      // inject bundleId snippet at the beginning of js/ts files using banner
      const bundleIdSnippet = faroBundleIdSnippet(bundleId, appName);

      // set banner for js files (esbuild banner only accepts "js" or "css" as keys)
      // the "js" banner applies to all JavaScript/TypeScript files (.js, .ts, .jsx, .tsx, .mjs, .cjs)
      // normalize banner to an object if it's a string or undefined
      let existingJsBanner = '';

      if (typeof build.initialOptions.banner === 'string') {
        // if banner is already a string, preserve it and convert to object
        existingJsBanner = build.initialOptions.banner;
        build.initialOptions.banner = {};
      } else if (!build.initialOptions.banner || typeof build.initialOptions.banner !== 'object') {
        // if banner is undefined or not an object, create a new object
        build.initialOptions.banner = {};
      } else {
        // if banner already exists as an object, preserve the existing js banner
        existingJsBanner = build.initialOptions.banner.js || '';
      }

      // prepend our bundleId snippet to any existing banner
      build.initialOptions.banner.js = bundleIdSnippet + existingJsBanner;

      // register onEnd callback to modify sourcemaps and optionally upload them
      build.onEnd(async (result) => {
        // determine output directory
        let outputDir: string | undefined;
        if (outputPath) {
          outputDir = outputPath;
        } else if (build.initialOptions.outdir) {
          outputDir = build.initialOptions.outdir;
        } else if (build.initialOptions.outfile) {
          outputDir = path.dirname(build.initialOptions.outfile);
        } else {
          verbose &&
            consoleInfoOrange(
              "No output directory found, skipping sourcemap processing"
            );
          return;
        }

        if (!outputDir) {
          return;
        }

        // ensure all source maps have a file property (do this regardless of skipUpload or prefixPath)
        try {
          const filenames = fs.readdirSync(outputDir, {
            recursive: recursive || false,
          });

          for (let filename of filenames) {
            // ensure filename is a string (fs.readdirSync with recursive can return Buffer)
            const filenameStr = filename.toString();
            const file = path.join(outputDir, filenameStr);

            // only include javascript-related source maps or match the outputFiles regex
            if (!shouldProcessFile(filenameStr, outputFiles)) {
              continue;
            }

            if (fs.existsSync(file)) {
              ensureSourceMapFileProperty(file, verbose);
            }
          }
        } catch (e) {
          console.error('Error ensuring source map file properties:', e);
        }

        // modify source map file properties if prefixPath is provided (do this regardless of skipUpload)
        if (prefixPath) {
          try {
            const filenames = fs.readdirSync(outputDir, {
              recursive: recursive || false,
            });

            for (let filename of filenames) {
              // ensure filename is a string (fs.readdirSync with recursive can return Buffer)
              const filenameStr = filename.toString();
              const file = path.join(outputDir, filenameStr);

              // only include javascript-related source maps or match the outputFiles regex
              if (!shouldProcessFile(filenameStr, outputFiles)) {
                continue;
              }

              if (fs.existsSync(file)) {
                modifySourceMapFileProperty(file, prefixPath, verbose);
              }
            }
          } catch (e) {
            console.error('Error modifying source maps:', e);
          }
        }

        // skip uploading if skipUpload is true
        if (skipUpload) {
          verbose &&
            consoleInfoOrange(
              `Skipping sourcemap upload as skipUpload is set to true`
            );
          return;
        }

        const uploadedSourcemaps = [];

        try {
          const sourcemapEndpoint = `${uploadEndpoint}${bundleId}`;
          const filesToUpload: string[] = [];
          let totalSize = 0;

          // read all files from output directory
          const filenames = fs.readdirSync(outputDir, {
            recursive: recursive || false,
          });

          for (let filename of filenames) {
            // ensure filename is a string (fs.readdirSync with recursive can return Buffer)
            const filenameStr = filename.toString();
            const file = path.join(outputDir, filenameStr);

            // only include javascript-related source maps or match the outputFiles regex
            if (!shouldProcessFile(filenameStr, outputFiles)) {
              continue;
            }

            // if we are tar/gzipping contents, collect N files and upload them all at once
            // total size of all files uploaded at once must be less than the configured max size (uncompressed)
            if (gzipContents && fs.existsSync(file)) {
              const { size } = fs.statSync(file);

              filesToUpload.push(file);
              totalSize += size;

              if (totalSize > maxSize) {
                filesToUpload.pop();
                const result = await uploadCompressedSourceMaps({
                  sourcemapEndpoint,
                  apiKey,
                  stackId,
                  outputPath: outputDir,
                  files: filesToUpload,
                  keepSourcemaps: !!keepSourcemaps,
                  verbose: verbose,
                  proxy: proxy,
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
                filename: filenameStr,
                filePath: file,
                keepSourcemaps: !!keepSourcemaps,
                verbose: verbose,
                proxy: proxy,
              });

              if (result) {
                uploadedSourcemaps.push(filenameStr);
              }
            }
          }

          // upload any remaining files
          if (filesToUpload.length) {
            const result = await uploadCompressedSourceMaps({
              sourcemapEndpoint,
              apiKey,
              stackId,
              outputPath: outputDir,
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
              ? `Uploaded sourcemaps: ${uploadedSourcemaps
                  .map((map) => map.split("/").pop())
                  .join(", ")}`
              : "No sourcemaps uploaded"
          );
        }
      });
    },
  };
}

module.exports = faroEsbuildPlugin;

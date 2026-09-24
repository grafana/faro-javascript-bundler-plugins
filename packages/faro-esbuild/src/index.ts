import * as esbuild from "esbuild";
import path from "path";
import {
  ESBUILD_PLUGIN_NAME,
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
  modifySourceMapFileProperty,
  ensureSourceMapFileProperty,
  findSourceMapFiles,
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
    prefixPathBasenameOnly,
    uploadConcurrency,
  } = pluginOptions;
  const bundleId =
    pluginOptions.bundleId ?? String(Date.now() + randomString(5));
  const uploadEndpoint = `${endpoint}/app/${appId}/sourcemaps/`;
  const maxSize =
    maxUploadSize && maxUploadSize > 0 ? maxUploadSize : THIRTY_MB_IN_BYTES;
  const gitHash = resolveGitHash(pluginOptions.gitHash);
  if (!gitHash) {
    consoleInfoOrange(`Git hash could not be resolved. window.__faroGitHash_${appName} will not be injected.`);
  }

  // export bundleId to environment variable if skipUpload is true
  if (skipUpload) {
    exportBundleIdToFile(bundleId, appName, verbose);
  }

  return {
    name: ESBUILD_PLUGIN_NAME,
    setup(build) {
      // inject bundleId (and optionally gitHash) snippet at the beginning of js/ts files using banner
      const bundleIdSnippet = faroBundleIdSnippet(bundleId, appName);
      const gitHashSnippet = gitHash ? faroGitHashSnippet(gitHash, appName) : '';

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

      // prepend our snippets to any existing banner
      build.initialOptions.banner.js = gitHashSnippet + bundleIdSnippet + existingJsBanner;

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

        let sourceMapFiles: ReturnType<typeof findSourceMapFiles>;

        try {
          sourceMapFiles = findSourceMapFiles(
            outputDir,
            outputFiles,
            recursive,
            gzipContents
          );
        } catch (e) {
          console.error('Error reading source maps:', e);
          return;
        }

        // ensure all source maps have a file property, and optionally prefix it,
        // regardless of whether upload is skipped.
        try {
          for (const { filePath } of sourceMapFiles) {
            if (prefixPath) {
              modifySourceMapFileProperty(filePath, prefixPath, verbose, prefixPathBasenameOnly);
            } else {
              ensureSourceMapFileProperty(filePath, verbose);
            }
          }
        } catch (e) {
          console.error('Error processing source maps:', e);
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
            for (const { filePath, size } of sourceMapFiles) {
              // if we are tar/gzipping contents, collect N files and upload them all at once
              // total size of all files uploaded at once must be less than the configured max size (uncompressed)
              const fileSize = size ?? 0;
              filesToUpload.push(filePath);
              totalSize += fileSize;

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
                filesToUpload.push(filePath);
                totalSize = fileSize;
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

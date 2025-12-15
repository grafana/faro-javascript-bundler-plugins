import * as webpack from "webpack";
import fs from "fs";

import {
  WEBPACK_PLUGIN_NAME,
  FaroSourceMapUploaderPluginOptions,
  faroBundleIdSnippet,
  randomString,
  uploadSourceMap,
  uploadCompressedSourceMaps,
  consoleInfoOrange,
  THIRTY_MB_IN_BYTES,
  exportBundleIdToFile,
  shouldProcessFile,
  normalizePrefix,
  ensureSourceMapFileProperty,
} from "@grafana/faro-bundlers-shared";
import { sources } from "webpack";
import path from "path";

interface BannerPluginOptions {
  hash?: string;
  chunk: webpack.Chunk;
  filename: string;
}

/**
 * Modifies source map assets to prepend a prefix to the file property
 * @param compilation The webpack compilation object
 * @param prefix The prefix to prepend (will be normalized)
 * @param verbose Whether to log verbose messages
 */
function modifySourceMapAssets(
  compilation: webpack.Compilation,
  prefix: string,
  verbose?: boolean
): void {
  const normalizedPrefix = normalizePrefix(prefix);

  Object.keys(compilation.assets).forEach((filename) => {
    if (filename.endsWith('.map')) {
      try {
        const sourceMapAsset = compilation.getAsset(filename);
        const sourceMapContent = sourceMapAsset?.source?.source()?.toString();
        const sourceMap = JSON.parse(sourceMapContent ?? '');

        if (!sourceMap.file) {
          sourceMap.file = filename.replace('.map', '');
        }

        if (sourceMap.file && !sourceMap.file.startsWith(normalizedPrefix)) {
          sourceMap.file = `${normalizedPrefix}${sourceMap.file}`;

          compilation.updateAsset(
            filename,
            new sources.RawSource(JSON.stringify(sourceMap))
          );

          verbose &&
            consoleInfoOrange(
              `Modified source map file property: ${filename} -> ${sourceMap.file}`
            );
        }
      } catch (error) {
        console.error(
          `Error modifying source map ${filename}:`,
          error instanceof Error ? error.message : String(error)
        );
      }
    }
  });
}

export interface WebpackFaroSourceMapUploaderPluginOptions extends FaroSourceMapUploaderPluginOptions {
  nextjs?: boolean;
  prefixPath?: string;
}

export default class FaroSourceMapUploaderPlugin
  implements webpack.WebpackPluginInstance {
  private appName: string;
  private apiKey: string;
  private stackId: string;
  private endpoint: string;
  private bundleId: string;
  private outputPathOverride?: string;
  private outputFiles?: string[] | RegExp;
  private recursive?: boolean;
  private keepSourcemaps?: boolean;
  private gzipContents?: boolean;
  private verbose?: boolean;
  private skipUpload?: boolean;
  private maxUploadSize: number;
  private nextjs?: boolean;
  private proxy?: string;
  private prefixPath?: string;

  constructor(options: WebpackFaroSourceMapUploaderPluginOptions) {
    this.appName = options.appName;
    this.apiKey = options.apiKey;
    this.stackId = options.stackId;
    this.endpoint = `${options.endpoint}/app/${options.appId}/sourcemaps/`;
    this.outputPathOverride = options.outputPath;
    this.outputFiles = options.outputFiles;
    this.recursive = options.recursive;
    this.bundleId = options.bundleId ?? String(Date.now() + randomString(5));
    this.keepSourcemaps = options.keepSourcemaps;
    this.gzipContents = options.gzipContents;
    this.verbose = options.verbose;
    this.skipUpload = options.skipUpload;
    this.nextjs = options.nextjs;
    this.prefixPath = options.prefixPath;
    this.maxUploadSize =
      options.maxUploadSize && options.maxUploadSize > 0
        ? options.maxUploadSize
        : THIRTY_MB_IN_BYTES;
    this.proxy = options.proxy;

    // Export bundleId to environment variable if skipUpload is true
    if (this.skipUpload) {
      exportBundleIdToFile(this.bundleId, this.appName, this.verbose);
    }
  }

  /**
   * Applies the plugin to the webpack compiler. Applies a BannerPlugin to the generated bundle containing the bundleId code snippet.
   * @param compiler The webpack compiler.
   */
  apply(compiler: webpack.Compiler): void {
    const BannerPlugin = compiler.webpack.BannerPlugin;
    const outputPath = this.outputPathOverride ?? compiler.options.output.path;

    compiler.options.plugins = compiler.options.plugins || [];
    compiler.options.plugins.push(
      new BannerPlugin({
        raw: true,
        include: /\.(js|ts|jsx|tsx|mjs|cjs)$/,
        banner: (options: BannerPluginOptions) => {
          return faroBundleIdSnippet(this.bundleId, this.appName);
        },
      })
    );

    // modify source map file properties if prefixPath or nextjs is provided
    // if both are provided, combine them as `${prefixPath}/_next/`
    let prefixToUse: string | undefined;
    if (this.prefixPath && this.nextjs) {
      prefixToUse = `${normalizePrefix(this.prefixPath)}_next/`;
    } else if (this.prefixPath) {
      prefixToUse = normalizePrefix(this.prefixPath);
    } else if (this.nextjs) {
      prefixToUse = '_next/';
    }

    if (prefixToUse) {
      const finalPrefix = prefixToUse; // capture for type narrowing
      compiler.hooks.compilation.tap(WEBPACK_PLUGIN_NAME, (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: WEBPACK_PLUGIN_NAME,
            stage: webpack.Compilation.PROCESS_ASSETS_STAGE_SUMMARIZE,
          },
          () => {
            modifySourceMapAssets(compilation, finalPrefix, this.verbose);
          }
        );
      });
    }

    // Skip uploading if skipUpload is true
    if (this.skipUpload) {
      this.verbose &&
        consoleInfoOrange(
          `Skipping sourcemap upload as skipUpload is set to true`
        );
      return;
    }

    compiler.hooks.afterEmit.tap(WEBPACK_PLUGIN_NAME, async () => {
      // upload the sourcemaps to the provided endpoint after the build is modified and done
      const uploadedSourcemaps = [];

      if (!outputPath) {
        return;
      }

      try {
        const filenames = fs.readdirSync(outputPath, { recursive: this.recursive });
        const sourcemapEndpoint = `${this.endpoint}${this.bundleId}`;
        const filesToUpload = [];
        let totalSize = 0;

        for (let filename of filenames) {
          // Ensure filename is a string (fs.readdirSync with recursive can return Buffer)
          const filenameStr = filename.toString();
          const file = path.join(outputPath, filenameStr);

          // Only include JavaScript-related source maps or match the outputFiles regex
          if (!shouldProcessFile(filenameStr, this.outputFiles)) {
            continue;
          }

          // if we are tar/gzipping contents, collect N files and upload them all at once
          // total size of all files uploaded at once must be less than the configured max size (uncompressed)
          if (this.gzipContents && fs.existsSync(file)) {
            const { size } = fs.statSync(file);

            filesToUpload.push(file);
            totalSize += size;

            if (totalSize > this.maxUploadSize) {
              filesToUpload.pop();
              const result = await uploadCompressedSourceMaps({
                sourcemapEndpoint,
                apiKey: this.apiKey,
                stackId: this.stackId,
                outputPath,
                files: filesToUpload,
                keepSourcemaps: !!this.keepSourcemaps,
                verbose: this.verbose,
                proxy: this.proxy,
              });

              if (result) {
                uploadedSourcemaps.push(...filesToUpload);
              }

              filesToUpload.length = 0;
              filesToUpload.push(file);
              totalSize = size;
            }
          }

          // if we are not compresing, upload each file individually
          if (!this.gzipContents) {
            const result = await uploadSourceMap({
              sourcemapEndpoint,
              apiKey: this.apiKey,
              stackId: this.stackId,
              filename: filenameStr,
              filePath: `${outputPath}/${filenameStr}`,
              keepSourcemaps: !!this.keepSourcemaps,
              verbose: this.verbose,
              proxy: this.proxy,
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
            apiKey: this.apiKey,
            stackId: this.stackId,
            outputPath,
            files: filesToUpload,
            keepSourcemaps: !!this.keepSourcemaps,
            verbose: this.verbose,
            proxy: this.proxy,
          });

          if (result) {
            uploadedSourcemaps.push(...filesToUpload);
          }
        }
      } catch (e) {
        console.error(e);
      }

      if (this.verbose) {
        consoleInfoOrange(
          uploadedSourcemaps.length
            ? `Uploaded sourcemaps: ${uploadedSourcemaps
              .map((map) => map.split("/").pop())
              .join(", ")}`
            : "No sourcemaps uploaded"
        );
      }
    });
  }
}

module.exports = FaroSourceMapUploaderPlugin;

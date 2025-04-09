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
} from "@grafana/faro-bundlers-shared";

interface BannerPluginOptions {
  hash?: string;
  chunk: webpack.Chunk;
  filename: string;
}

export default class FaroSourceMapUploaderPlugin
  implements webpack.WebpackPluginInstance
{
  private appName: string;
  private apiKey: string;
  private stackId: string;
  private endpoint: string;
  private bundleId: string;
  private outputPathOverride?: string;
  private outputFiles?: string[] | RegExp;
  private keepSourcemaps?: boolean;
  private gzipContents?: boolean;
  private verbose?: boolean;
  private skipUpload?: boolean;
  private maxUploadSize: number;

  constructor(options: FaroSourceMapUploaderPluginOptions) {
    this.appName = options.appName;
    this.apiKey = options.apiKey;
    this.stackId = options.stackId;
    this.endpoint = `${options.endpoint}/app/${options.appId}/sourcemaps/`;
    this.outputPathOverride = options.outputPath;
    this.outputFiles = options.outputFiles;
    this.bundleId = options.bundleId ?? String(Date.now() + randomString(5));
    this.keepSourcemaps = options.keepSourcemaps;
    this.gzipContents = options.gzipContents;
    this.verbose = options.verbose;
    this.skipUpload = options.skipUpload;
    this.maxUploadSize = options.maxUploadSize && options.maxUploadSize > 0
      ? options.maxUploadSize
      : THIRTY_MB_IN_BYTES;

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

    // Skip uploading if skipUpload is true
    if (this.skipUpload) {
      this.verbose && consoleInfoOrange(`Skipping sourcemap upload as skipUpload is set to true`);
      return;
    }

    compiler.hooks.afterEmit.tap(WEBPACK_PLUGIN_NAME, async () => {
      // upload the sourcemaps to the provided endpoint after the build is modified and done
      const uploadedSourcemaps = [];

      if (!outputPath) {
        return;
      }

      try {
        const filenames = fs.readdirSync(outputPath);
        const sourcemapEndpoint = `${this.endpoint}${this.bundleId}`;
        const filesToUpload = [];
        let totalSize = 0;

        for (let filename of filenames) {
          const file = `${outputPath}/${filename}`;

          // Only include JavaScript-related source maps or match the outputFiles regex
          if (!shouldProcessFile(filename, this.outputFiles)) {
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
              filename,
              filePath: `${outputPath}/${filename}`,
              keepSourcemaps: !!this.keepSourcemaps,
              verbose: this.verbose,
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
            apiKey: this.apiKey,
            stackId: this.stackId,
            outputPath,
            files: filesToUpload,
            keepSourcemaps: !!this.keepSourcemaps,
            verbose: this.verbose,
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
            ? `Uploaded sourcemaps: ${uploadedSourcemaps.map(map => map.split('/').pop()).join(", ")}`
            : "No sourcemaps uploaded"
        );
      }
    });
  }
}

module.exports = FaroSourceMapUploaderPlugin;

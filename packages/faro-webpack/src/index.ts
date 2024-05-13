import * as webpack from "webpack";
import fs from "fs";

import {
  WEBPACK_PLUGIN_NAME,
  FaroSourcemapUploaderPluginOptions,
  faroBundleIdSnippet,
  randomString,
  uploadSourceMap,
  uploadCompressedSourceMaps,
  consoleInfoOrange,
  THIRTY_MB_IN_BYTES,
} from "@grafana/faro-bundlers-shared";

interface BannerPluginOptions {
  hash: string;
  chunk: webpack.Chunk;
  filename: string;
}

export default class FaroSourcemapUploaderPlugin
  implements webpack.WebpackPluginInstance
{
  private appName: string;
  private orgId: string;
  private endpoint: string;
  private outputFiles: string[];
  private bundleId: string;
  private keepSourcemaps?: boolean;
  private gzipContents?: boolean;
  private verbose?: boolean;

  constructor(options: FaroSourcemapUploaderPluginOptions) {
    this.appName = options.appName;
    this.orgId = options.orgId;
    this.endpoint = `${options.endpoint}/app/${options.appId}/sourcemaps/`;
    this.outputFiles = options.outputFiles;
    this.bundleId = options.bundleId ?? String(Date.now() + randomString(5));
    this.keepSourcemaps = options.keepSourcemaps;
    this.gzipContents = options.gzipContents;
    this.verbose = options.verbose;
  }

  apply(compiler: webpack.Compiler): void {
    const BannerPlugin = compiler.webpack.BannerPlugin;
    const outputPath = compiler.options.output.path;

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

    compiler.hooks.afterEmit.tap(WEBPACK_PLUGIN_NAME, async () => {
      // upload the sourcemaps to the provided endpoint after the build is modified and done
      const uploadedSourcemaps = [];
      try {
        const filenames = fs.readdirSync(outputPath!);
        const sourcemapEndpoint = `${this.endpoint}${this.bundleId}`;
        const filesToUpload = [];
        let totalSize = 0;

        for (let filename of filenames) {
          // only upload sourcemaps or contents in the outputFiles list
          if (
            this.outputFiles.length
              ? !this.outputFiles.map((o) => o + ".map").includes(filename)
              : !filename.endsWith(".map")
          ) {
            continue;
          }

          // if we are tar/gzipping contents, collect N files and upload them all at once
          // total size of all files uploaded at once must be less than 30mb (uncompressed)
          if (this.gzipContents) {
            const file = `${outputPath}/${filename}`;
            const { size } = fs.statSync(file);

            filesToUpload.push(file);
            totalSize += size;

            if (totalSize > THIRTY_MB_IN_BYTES) {
              filesToUpload.pop();
              const result = await uploadCompressedSourceMaps({
                sourcemapEndpoint,
                orgId: this.orgId,
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
              filename,
              orgId: this.orgId,
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
            orgId: this.orgId,
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

      if (uploadedSourcemaps.length && this.verbose) {
        consoleInfoOrange(
          `Uploaded sourcemaps: ${uploadedSourcemaps.map(map => map.split('/').pop()).join(", ")}`
        );
      }
    });
  }
}

module.exports = FaroSourcemapUploaderPlugin;

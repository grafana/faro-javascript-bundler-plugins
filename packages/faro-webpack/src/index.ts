import * as webpack from "webpack";
import fs from "fs";

import {
  WEBPACK_PLUGIN_NAME,
  FaroSourcemapUploaderPluginOptions,
  faroBundleIdSnippet,
  randomString,
  uploadSourceMap,
  consoleInfoOrange,
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
  private endpoint: string;
  private outputFiles: string[];
  private bundleId: string;
  private keepSourcemaps?: boolean;
  private gzipContents?: boolean;
  private verbose?: boolean;

  constructor(options: FaroSourcemapUploaderPluginOptions) {
    this.appName = options.appName;
    this.endpoint = `${options.endpoint}/app/${options.appId}/sourcemap/`;
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

        for (let filename of filenames) {
          if (
            this.outputFiles.length
              ? this.outputFiles.map((o) => o + ".map").includes(filename)
              : filename.endsWith(".map")
          ) {
            this.verbose &&
              consoleInfoOrange(`Uploading sourcemap "${filename}"`);

            const result = await uploadSourceMap({
              sourcemapEndpoint,
              filename,
              outputPath: `${outputPath}/${filename}`,
              keepSourcemaps: !!this.keepSourcemaps,
              gzip: !!this.gzipContents,
              verbose: this.verbose,
            });

            if (result) {
              uploadedSourcemaps.push(filename);
            }
          }
        }
      } catch (e) {
        console.error(e);
      }

      if (uploadedSourcemaps.length && this.verbose) {
        consoleInfoOrange(
          `Uploaded sourcemaps: ${uploadedSourcemaps.join(", ")}`
        );
      }
    });
  }
}

module.exports = FaroSourcemapUploaderPlugin;

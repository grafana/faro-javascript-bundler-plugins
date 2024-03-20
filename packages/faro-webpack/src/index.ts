import * as webpack from "webpack";
import fetch from "cross-fetch";

import { WEBPACK_PLUGIN_NAME, FaroSourcemapUploaderPluginOptions, faroBuildIdSnippet, stringToUUID, randomString } from "@grafana/faro-bundlers-shared";

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
  private fileToHashMap: Map<string, string> = new Map();

  constructor(options: FaroSourcemapUploaderPluginOptions) {
    this.appName = options.appName;
    this.endpoint =
      options.endpoint.split("collect/")[0] + `app/${options.appId}/sourcemap/`;
    this.outputFiles = options.outputFiles;
    this.bundleId = options.bundleId ?? String(Date.now() + randomString(5));
  }

  apply(compiler: webpack.Compiler): void {
    const BannerPlugin = compiler.webpack.BannerPlugin;

    compiler.options.plugins = compiler.options.plugins || [];
    compiler.options.plugins.push(
      new BannerPlugin({
        raw: true,
        include: /\.(js|ts|jsx|tsx|mjs|cjs)$/,
        banner: (options: BannerPluginOptions) => {
          const fileHash = stringToUUID(options.filename);
          const chunkId = `${this.bundleId}::${fileHash}`;
          this.fileToHashMap.set(options.filename, fileHash);

          return faroBuildIdSnippet(chunkId, this.appName)
        },
      })
    );

    compiler.hooks.make.tap(WEBPACK_PLUGIN_NAME, (compilation) => {
      // upload the sourcemaps to the provided endpoint after the build is modified and done
      compilation.hooks.afterProcessAssets.tap(
        {
          name: WEBPACK_PLUGIN_NAME,
        },
        (assets) => {
          for (let a in assets) {
            const asset = compilation.getAsset(a);

            if (!asset) {
              continue;
            }

            if (
              this.outputFiles.length
                ? this.outputFiles.map((o) => o + ".map").includes(a)
                : a.endsWith(".map")
            ) {
              const sourceFile = a.replace(/(.map)/, '');
              const sourcemap = JSON.parse(asset.source.source().toString());
              const sourcemapEndpoint = `${this.endpoint}${this.bundleId}/${this.fileToHashMap.get(sourceFile)}`;

              console.log("ASSET: ", a, this.fileToHashMap.get(sourceFile), sourcemapEndpoint);

              const response = fetch(sourcemapEndpoint, {
                method: "POST",
                body: sourcemap,
              });
              response
                .then((res) => {
                  // console.log("SOURCEMAP UPLOAD RESPONSE: ", res.status);
                })
                .catch((err) => {
                  // console.log("SOURCEMAP UPLOAD ERROR: ", err);
                });
            }
          }
        }
      );
    });
  }
}

module.exports = FaroSourcemapUploaderPlugin;

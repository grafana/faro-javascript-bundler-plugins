import * as webpack from "webpack";
import fetch from "cross-fetch";

import { WEBPACK_PLUGIN_NAME, FaroSourcemapUploaderPluginOptions, faroBuildIdSnippet } from "@grafana/faro-bundlers-shared";

interface BannerPluginOptions {
  hash: string;
  chunk: webpack.Chunk;
  filename: string;
}

export default class FaroSourcemapUploaderPlugin
  implements webpack.WebpackPluginInstance
{
  private endpoint: string;
  private outputFiles: string[];

  constructor(options: FaroSourcemapUploaderPluginOptions) {
    this.endpoint =
      options.endpoint.split("collect/")[0] + `app/${options.appId}/sourcemap/`;
    this.outputFiles = options.outputFiles;
  }

  apply(compiler: webpack.Compiler): void {
    let hash: string;
    const BannerPlugin = compiler.webpack.BannerPlugin;

    compiler.options.plugins = compiler.options.plugins || [];
    compiler.options.plugins.push(
      new BannerPlugin({
        raw: true,
        include: /\.(js|ts|jsx|tsx|mjs|cjs)$/,
        banner: (options: BannerPluginOptions) => {
          hash = options.chunk?.hash ?? '';
          return faroBuildIdSnippet(options.chunk?.hash || options.filename)
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
              const sourcemap = JSON.parse(asset.source.source().toString());
              const sourcemapEndpoint = this.endpoint + hash;

              const response = fetch(sourcemapEndpoint, {
                method: "POST",
                body: sourcemap,
              });
              response
                .then((res) => {
                  console.log("SOURCEMAP UPLOAD RESPONSE: ", res.status);
                })
                .catch((err) => {
                  console.log("SOURCEMAP UPLOAD ERROR: ", err);
                });
            }
          }
        }
      );
    });
  }
}

module.exports = FaroSourcemapUploaderPlugin;

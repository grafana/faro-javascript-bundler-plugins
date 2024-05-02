import * as webpack from "webpack";
import fs from "fs";
import fetch from "cross-fetch";

import {
  WEBPACK_PLUGIN_NAME,
  FaroSourcemapUploaderPluginOptions,
  faroBundleIdSnippet,
  randomString,
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

  constructor(options: FaroSourcemapUploaderPluginOptions) {
    this.appName = options.appName;
    this.endpoint = `${options.endpoint}/app/${options.appId}/sourcemap/`;
    this.outputFiles = options.outputFiles;
    this.bundleId = options.bundleId ?? String(Date.now() + randomString(5));
    this.keepSourcemaps = options.keepSourcemaps;
  }

  /**
   * Applies the plugin to the webpack compiler. Applies a BannerPlugin to the generated bundle containing the bundleId code snippet.
   * @param compiler The webpack compiler.
   */
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
              const sourcemapEndpoint = `${this.endpoint}${this.bundleId}`;

              fetch(sourcemapEndpoint, {
                method: "POST",
                body: sourcemap,
              })
                .then((res) => {
                  if (res.ok) {
                    console.info(`Uploaded ${a} to ${sourcemapEndpoint}`);
                  } else {
                    console.info(`Upload of ${a} failed with status: ${res.status}, ${res.body}`);
                  }

                  // delete source map
                  const sourceMapToDelete = `${outputPath}/${a}`;
                  if (
                    !this.keepSourcemaps &&
                    fs.existsSync(sourceMapToDelete)
                  ) {
                    fs.unlinkSync(sourceMapToDelete);
                  }
                })
                .catch((err) => console.error(err));
            }
          }
        }
      );
    });
  }
}

module.exports = FaroSourcemapUploaderPlugin;

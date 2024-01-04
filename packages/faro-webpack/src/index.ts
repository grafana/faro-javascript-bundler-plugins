import * as webpack from "webpack";
import axios from "axios";

const PLUGIN_NAME = "FaroSourcemapUploaderPlugin";

interface FaroSourcemapUploaderPluginOptions {
  endpoint: string;
  appId: string;
  outputFiles: string[];
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
    let stats: webpack.StatsCompilation;

    compiler.hooks.make.tap(PLUGIN_NAME, (compilation) => {
      // modify the compilation to add a build ID to the end of the bundle
      compilation.hooks.processAssets.tap(
        {
          name: PLUGIN_NAME,
          stage: webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONS,
        },
        (assets) => {
          const { devtool } = compiler.options;
          const { RawSource, SourceMapSource } = webpack.sources;
          stats = compilation.getStats().toJson();

          for (let a in assets) {
            const asset = compilation.getAsset(a);

            if (!asset) {
              continue;
            }

            const contents = asset.source.source();
            const { map } = asset.source.sourceAndMap();

            if (
              this.outputFiles.length
                ? this.outputFiles.includes(a)
                : a.endsWith(".js")
            ) {
              const newContent = `${contents}
              (function (){
                var globalObj = (typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : typeof self !== 'undefined' ? self : {});
                globalObj.FARO_BUILD_ID = "${stats.hash}";
                })();`;

              compilation.updateAsset(
                a,
                devtool
                  ? new SourceMapSource(newContent, a, map)
                  : new RawSource(newContent)
              );
            }
          }
        }
      );

      // upload the sourcemaps to the provided endpoint after the build is modified and done
      compilation.hooks.afterProcessAssets.tap(
        {
          name: PLUGIN_NAME,
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
              const sourcemapEndpoint = this.endpoint + stats.hash;

              const response = axios.post(sourcemapEndpoint, sourcemap)
              response.then((res) => {
                console.log("SOURCEMAP UPLOAD RESPONSE: ", res.status);
              }).catch((err) => {
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

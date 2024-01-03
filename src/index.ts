import * as webpack from "webpack";

const PLUGIN_NAME = "FaroSourcemapUploaderPlugin";

export default class FaroSourcemapUploaderPlugin
  implements webpack.WebpackPluginInstance
{
  apply(compiler: webpack.Compiler): void {
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
          const stats = compilation.getStats().toJson();

          for (let a in assets) {
            const asset = compilation.getAsset(a);

            if (!asset) {
              continue;
            }

            const contents = asset.source.source();
            const { map } = asset.source.sourceAndMap();

            if (a.endsWith(".js")) {
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
            if (a.endsWith(".map")) {
              const asset = compilation.getAsset(a);

              if (!asset) {
                continue;
              }

              // const { map } = asset.source.sourceAndMap();

              console.log("UPLOADING MAP");
            }
          }
        }
      );
    });
  }
}

module.exports = FaroSourcemapUploaderPlugin;

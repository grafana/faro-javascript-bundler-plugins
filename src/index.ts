import * as webpack from "webpack";

class FaroSourcemapUploaderPlugin implements webpack.WebpackPluginInstance {
  // Define `apply` as its prototype method which is supplied with compiler as its argument
  apply(compiler: webpack.Compiler): void {
    // Specify the event hook to attach to
    compiler.hooks.make.tapAsync(
      "FaroSourcemapUploaderPlugin",
      (compilation, callback) => {
        const { RawSource } = webpack.sources;

        compilation.hooks.afterCodeGeneration.tap(
          "FaroSourcemapUploaderPlugin",
          () => {
            compilation.modules.forEach((module) => {
              const sourceMap = compilation.codeGenerationResults.get(
                module,
                "javascript"
              ).sources;

              const stats = compilation.getStats().toJson();
              const rawSource = sourceMap.get("javascript");

              if (rawSource) {
                sourceMap.set(
                  "javascript",
                  new RawSource(
                    `${rawSource.source()}
(function (){
var globalObj = (typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : typeof self !== 'undefined' ? self : {});
globalObj.FARO_BUILD_ID = "${stats.hash}";
})();`
                  )
                );

                // after injecting the build id, we need to upload the source map to the endpoint
                console.log(sourceMap.get("javascript"));
              }
            });

            callback();
          }
        );
      }
    );
  }
}

module.exports.default = FaroSourcemapUploaderPlugin;

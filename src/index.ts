import { RawSource } from "webpack-sources";

class FaroSourcemapUploaderPlugin {
  // Define `apply` as its prototype method which is supplied with compiler as its argument
  apply(compiler) {
    // Specify the event hook to attach to
    compiler.hooks.make.tapAsync(
      "FaroSourcemapUploaderPlugin",
      (compilation, cb) => {
        compilation.hooks.afterCodeGeneration.tap("FaroSourcemapUploaderPlugin", () => {
          compilation.modules.forEach((module) => {
            const sourceMap =
              compilation.codeGenerationResults.get(module).sources;
            const rawSource = sourceMap.get("javascript");
            const OPTIONS = {
              project: "project",
              org: "org",
              version: 1,
            };

            if (rawSource) {
              sourceMap.set(
                "javascript",
                new RawSource(
                  `${rawSource.source()}
(function (){
var globalThis = (typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : typeof self !== 'undefined' ? self : {});
globalThis.FARO_BUILD_ID = globalThis.FARO_BUILD_ID || {};
globalThis.FARO_BUILD_ID["${OPTIONS.project}@${OPTIONS.org}"] = {"id":"${
                    OPTIONS.version
                  }"};
})();`
                )
              );
            }

            // after injecting the build id, we need to upload the source map to the endpoint
            console.log(sourceMap.source());
          });
        });
      }
    );
  }
}

module.exports.default = FaroSourcemapUploaderPlugin;

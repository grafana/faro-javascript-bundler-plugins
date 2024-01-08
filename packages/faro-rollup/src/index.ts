import {
  Plugin,
  OutputOptions,
  OutputBundle,
  OutputAsset,
  OutputChunk,
} from "rollup";
import fetch from "cross-fetch";
import MagicString from "magic-string";
import { ROLLUP_PLUGIN_NAME, FaroSourcemapUploaderPluginOptions, faroBuildIdSnippet } from "../../consts";

interface FaroSourcemapRollupPluginContext {
  endpoint: string;
  hash: string;
}

export default function faroUploader(
  pluginOptions: FaroSourcemapUploaderPluginOptions
): Plugin {
  const { endpoint, appId, outputFiles } = pluginOptions;
  const context: FaroSourcemapRollupPluginContext = {
    endpoint: endpoint.split("collect/")[0] + `app/${appId}/sourcemap/`,
    hash: "",
  };

  return {
    name: ROLLUP_PLUGIN_NAME,
    renderChunk(code, chunk, options, meta) {
      this.info(`adding code here - ${chunk.fileName}`);
      this.info(`chunks - ${Object.keys(meta.chunks).toString()}`);

      const newCode = new MagicString(code);
      newCode.append(faroBuildIdSnippet(chunk.fileName));

      const map = newCode.generateMap({
        source: chunk.fileName,
        file: `${chunk.fileName}.map`,
        includeContent: true
      });

      return {
        code: newCode.toString(),
        map
      };
    },
    writeBundle(options: OutputOptions, bundle: OutputBundle): void {
      this.info(`${Object.keys(bundle).toString()} - bundle`);

      const files = Object.keys(bundle).map((f) => f.split("/").pop());
      this.info(files.toString());

      for (let a in bundle) {
        const asset = bundle[a];
        this.info(Object.keys(asset).toString());
        const source =
          (asset as OutputAsset).source || (asset as OutputChunk).code;

        if (!asset || !source) {
          continue;
        }

        if (
          outputFiles.length
            ? outputFiles
                .map((o) => o + ".map")
                .includes(a.split("/").pop() || "")
            : a.endsWith(".map")
        ) {
          const sourcemap = JSON.parse(source.toString());
          const sourcemapEndpoint = context.endpoint + context.hash;

          const response = fetch(sourcemapEndpoint, {
            method: "POST",
            body: sourcemap,
          });
          response
            .then((res) => {
              this.info(`SOURCEMAP UPLOAD RESPONSE: ${res.status}`);
            })
            .catch((err) => {
              this.info(`SOURCEMAP UPLOAD ERROR: ${err}`);
            });
        }
      }
    },
  };
}

module.exports = faroUploader;

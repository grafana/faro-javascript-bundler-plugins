import {
  Plugin,
  OutputOptions,
  OutputBundle,
  OutputAsset,
  OutputChunk,
} from "rollup";
import fetch from "cross-fetch";
import MagicString from "magic-string";
import {
  ROLLUP_PLUGIN_NAME,
  FaroSourcemapUploaderPluginOptions,
  faroArtifactIdSnippet,
  stringToMD5,
  randomString,
} from "@grafana/faro-bundlers-shared";

interface FaroSourcemapRollupPluginContext {
  endpoint: string;
  hash: string;
  bundleId?: string;
}

export default function faroUploader(
  pluginOptions: FaroSourcemapUploaderPluginOptions
): Plugin {
  const { endpoint, appId, appName, outputFiles } = pluginOptions;
  const bundleId = pluginOptions.bundleId ?? String(Date.now() + randomString(5));
  const context: FaroSourcemapRollupPluginContext = {
    endpoint: endpoint.split("collect/")[0] + `app/${appId}/sourcemap/`,
    hash: "",
  };

  return {
    name: ROLLUP_PLUGIN_NAME,
    renderChunk(code, chunk) {
      if (
        [".js", ".mjs", ".cjs"].some((ending) =>
          chunk.fileName.endsWith(ending)
        )
      ) {
        const newCode = new MagicString(code);
        const md5sum = stringToMD5(chunk.fileName);
        const artifactId = `${bundleId}::${md5sum}`;

        newCode.append(faroArtifactIdSnippet(artifactId, appName));

        const map = newCode.generateMap({
          source: chunk.fileName,
          file: `${chunk.fileName}.map`,
        });

        return {
          code: newCode.toString(),
          map,
        };
      }

      return null;
    },
    writeBundle(options: OutputOptions, bundle: OutputBundle): void {
      for (let a in bundle) {
        const asset = bundle[a];
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
          const md5sum = stringToMD5(a.split('.map')[0]);
          const sourcemap = JSON.parse(source.toString());
          const sourcemapEndpoint = context.endpoint + bundleId + md5sum;

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

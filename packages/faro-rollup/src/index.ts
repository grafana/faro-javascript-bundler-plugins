import {
  Plugin,
  OutputOptions,
  OutputBundle,
  OutputAsset,
  OutputChunk,
} from "rollup";
import fs from "fs";
import fetch from "cross-fetch";
import MagicString from "magic-string";
import {
  ROLLUP_PLUGIN_NAME,
  FaroSourcemapUploaderPluginOptions,
  faroBundleIdSnippet,
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
  const { endpoint, appId, appName, outputFiles, keepSourcemaps } =
    pluginOptions;
  const bundleId =
    pluginOptions.bundleId ?? String(Date.now() + randomString(5));
  const context: FaroSourcemapRollupPluginContext = {
    endpoint: `${endpoint}/app/${appId}/sourcemap/`,
    hash: "",
  };

  return {
    name: ROLLUP_PLUGIN_NAME,
    renderChunk(code, chunk) {
      if (chunk.fileName.match(/\.(js|ts|jsx|tsx|mjs|cjs)$/)) {
        const newCode = new MagicString(code);

        newCode.append(faroBundleIdSnippet(bundleId, appName));

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
      const outputPath = options.dir;

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
          const sourcemap = JSON.parse(source.toString());
          const sourcemapEndpoint = context.endpoint + bundleId;

          fetch(sourcemapEndpoint, {
            method: "POST",
            body: sourcemap,
          })
            .then((res) => {
              if (res.ok) {
                console.info(`Uploaded ${a} to ${sourcemapEndpoint}`);
              } else {
                console.info(
                  `Upload of ${a} failed with status: ${res.status}, ${res.body}`
                );
              }

              // delete source map
              const sourceMapToDelete = `${outputPath}/${a}`;
              if (!keepSourcemaps && fs.existsSync(sourceMapToDelete)) {
                fs.unlinkSync(sourceMapToDelete);
              }
            })
            .catch((err) => console.error(err));
        }
      }
    },
  };
}

module.exports = faroUploader;

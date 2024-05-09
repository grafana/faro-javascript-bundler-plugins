import {
  Plugin,
  OutputOptions,
  OutputBundle,
  OutputAsset,
  OutputChunk,
} from "rollup";
import MagicString from "magic-string";
import {
  ROLLUP_PLUGIN_NAME,
  FaroSourcemapUploaderPluginOptions,
  faroBundleIdSnippet,
  randomString,
  consoleInfoOrange,
  uploadSourceMap,
} from "@grafana/faro-bundlers-shared";

export default function faroUploader(
  pluginOptions: FaroSourcemapUploaderPluginOptions
): Plugin {
  const {
    endpoint,
    appId,
    appName,
    outputFiles,
    keepSourcemaps,
    gzipContents,
    verbose,
  } = pluginOptions;
  const bundleId =
    pluginOptions.bundleId ?? String(Date.now() + randomString(5));
  const uploadEndpoint = `${endpoint}/app/${appId}/sourcemap/`;

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
    async writeBundle(options: OutputOptions, bundle: OutputBundle) {
      const uploadedSourcemaps = [];

      try {
        const outputPath = options.dir;
        const sourcemapEndpoint = uploadEndpoint + bundleId;

        for (let filename in bundle) {
          const asset = bundle[filename];
          const source =
            (asset as OutputAsset).source || (asset as OutputChunk).code;

          if (!asset || !source) {
            continue;
          }

          if (
            outputFiles.length
              ? outputFiles.map((o) => o + ".map").includes(filename)
              : filename.endsWith(".map")
          ) {
            verbose && consoleInfoOrange(`Uploading sourcemap "${filename}"`);

            const result = await uploadSourceMap({
              sourcemapEndpoint,
              filename,
              outputPath: `${outputPath}/${filename}`,
              keepSourcemaps: !!keepSourcemaps,
              gzip: !!gzipContents,
              verbose: verbose,
            });

            if (result) {
              uploadedSourcemaps.push(filename);
            }
          }
        }
      } catch (e) {
        console.error(e);
      }

      if (uploadedSourcemaps.length && verbose) {
        consoleInfoOrange(
          `Uploaded sourcemaps: ${uploadedSourcemaps.join(", ")}`
        );
      }
    },
  };
}

module.exports = faroUploader;

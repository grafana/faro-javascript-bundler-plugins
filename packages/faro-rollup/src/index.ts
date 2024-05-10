import { Plugin, OutputOptions, OutputBundle } from "rollup";
import MagicString from "magic-string";
import {
  ROLLUP_PLUGIN_NAME,
  FaroSourcemapUploaderPluginOptions,
  faroBundleIdSnippet,
  randomString,
  consoleInfoOrange,
  uploadSourceMap,
  uploadCompressedSourceMaps,
} from "@grafana/faro-bundlers-shared";

import fs from "fs";

export default function faroUploader(
  pluginOptions: FaroSourcemapUploaderPluginOptions
): Plugin {
  const {
    endpoint,
    appId,
    orgId,
    appName,
    outputFiles,
    keepSourcemaps,
    gzipContents,
    verbose,
  } = pluginOptions;
  const bundleId =
    pluginOptions.bundleId ?? String(Date.now() + randomString(5));
  const uploadEndpoint = `${endpoint}/app/${appId}/sourcemaps/`;

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
        const filesToUpload = [];
        let totalSize = 0;

        for (let filename in bundle) {
          // only upload sourcemaps or contents in the outputFiles list
          if (
            outputFiles.length
              ? !outputFiles.map((o) => o + ".map").includes(filename)
              : !filename.endsWith(".map")
          ) {
            continue;
          }

          // if we are tar/gzipping contents, collect N files and upload them all at once
          // total size of all files uploaded at once must be less than 30mb (uncompressed)
          if (gzipContents) {
            const file = `${outputPath}/${filename}`;
            const { size } = fs.statSync(file);

            if (totalSize + size > 30 * 1024 * 1024) {
              const result = await uploadCompressedSourceMaps({
                sourcemapEndpoint,
                orgId: orgId,
                files: filesToUpload,
                keepSourcemaps: !!keepSourcemaps,
                verbose: verbose,
              });

              if (result) {
                uploadedSourcemaps.push(...filesToUpload);
              }

              filesToUpload.length = 0;
              filesToUpload.push(file);
              totalSize = size;
            }
          }

          // if we are not compresing, upload each file individually
          if (!gzipContents) {
            const result = await uploadSourceMap({
              sourcemapEndpoint,
              filename,
              orgId: orgId,
              filePath: `${outputPath}/${filename}`,
              keepSourcemaps: !!keepSourcemaps,
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

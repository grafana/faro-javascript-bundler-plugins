import crypto from "crypto";
import fs from "fs";
import { create } from "tar";
import fetch from "cross-fetch";
import ansi from "ansis";
import path from "path";
export interface FaroSourceMapUploaderPluginOptions {
  endpoint: string;
  appName: string;
  appId: string;
  apiKey: string;
  stackId: string;
  outputPath?: string;
  outputFiles?: string[] | RegExp;
  bundleId?: string;
  keepSourcemaps?: boolean;
  gzipContents?: boolean;
  verbose?: boolean;
  skipUpload?: boolean;
  maxUploadSize?: number; // Maximum upload size in bytes
  recursive?: boolean; // Whether to recursively search subdirectories for sourcemaps
}

interface UploadSourceMapOptions {
  sourcemapEndpoint: string;
  apiKey: string;
  stackId: string;
  filePath: string;
  filename: string;
  keepSourcemaps: boolean;
  verbose?: boolean;
}

interface UploadCompressedSourceMapsOptions {
  sourcemapEndpoint: string;
  apiKey: string;
  stackId: string;
  outputPath: string;
  files: string[];
  keepSourcemaps: boolean;
  verbose?: boolean;
}

export const uploadSourceMap = async (
  options: UploadSourceMapOptions
): Promise<boolean> => {
  const {
    sourcemapEndpoint,
    filePath,
    apiKey,
    stackId,
    keepSourcemaps,
    verbose,
    filename,
  } = options;
  let success = true;

  verbose && consoleInfoOrange(`Uploading ${filename} to ${sourcemapEndpoint}`);
  await fetch(sourcemapEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${stackId}:${apiKey}`,
    },
    body: fs.readFileSync(filePath),
  })
    .then((res) => {
      if (res.ok) {
        verbose &&
          consoleInfoOrange(`Uploaded ${filename} to ${sourcemapEndpoint}`);
      } else {
        success = false;
        consoleInfoOrange(
          `Upload of ${filename} failed with status: ${res.status}`
        );
      }

      // delete source map
      if (!keepSourcemaps && fs.existsSync(filePath)) {
        verbose && consoleInfoOrange(`Deleting ${filename}`);
        fs.unlinkSync(filePath);
      }
    })
    .catch((err) => console.error(err));

  return success;
};

export const uploadCompressedSourceMaps = async (
  options: UploadCompressedSourceMapsOptions
): Promise<boolean> => {
  const { sourcemapEndpoint, stackId, files, keepSourcemaps, outputPath, apiKey, verbose } = options;

  let success = true;

  const tarball = `${outputPath}/${randomString()}.tar.gz`;
  await create({ z: true, file: tarball }, files);

  verbose &&
    consoleInfoOrange(
      `Uploading ${files
        .map((file) => file.split("/").pop())
        .join(", ")} to ${sourcemapEndpoint}`
    );
  await fetch(sourcemapEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/gzip",
      "Authorization": `Bearer ${stackId}:${apiKey}`,
    },
    body: fs.readFileSync(tarball),
  })
    .then((res) => {
      if (res.ok) {
        verbose &&
          consoleInfoOrange(
            `Uploaded ${files
              .map((file) => file.split("/").pop())
              .join(", ")} to ${sourcemapEndpoint}`
          );
      } else {
        success = false;
        consoleInfoOrange(
          `Upload of ${files
            .map((file) => file.split("/").pop())
            .join(", ")} failed with status: ${res.status}`
        );
      }

      // delete tarball
      if (fs.existsSync(tarball)) {
        fs.unlinkSync(tarball);
      }

      if (keepSourcemaps) {
        return;
      }

      // delete source maps
      verbose &&
        consoleInfoOrange(
          `Deleting ${files.map((file) => file.split("/").pop()).join(", ")}`
        );
      for (let filePath of files) {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }
    })
    .catch((err) => console.error(err));

  return success;
};

export const shouldProcessFile = (filename: string, outputFiles: string[] | RegExp | undefined) => {
  // Must be a JavaScript sourcemap
  if (!JS_SOURCEMAP_PATTERN.test(filename)) {
    return false;
  }

  // If regex filter exists, filename must match it
  if (outputFiles instanceof RegExp && !outputFiles.test(filename)) {
    return false;
  }

  // If array filter exists, filename must be in it
  if (Array.isArray(outputFiles) && outputFiles?.length) {
    return includedInOutputFiles(filename, outputFiles);
  }

  return true;
}

const includedInOutputFiles = (filename: string, outputFiles: string[] | undefined) => {
  // If no filter exists, return true
  if (!outputFiles) {
    return true;
  }

  if (Array.isArray(outputFiles) && outputFiles?.length) {
    return outputFiles.map((o: string) => o + ".map").includes(filename);
  }

  return false;
}

export const faroBundleIdSnippet = (bundleId: string, appName: string) => {
  return `(function(){try{var g=typeof window!=="undefined"?window:typeof global!=="undefined"?global:typeof self!=="undefined"?self:{};g["__faroBundleId_${appName}"]="${bundleId}"}catch(l){}})();`;
};

export function randomString(length?: number): string {
  return crypto.randomBytes(length ?? 10).toString("hex");
}

export const consoleInfoOrange = (message: string) =>
  console.info(ansi.fg(214)`[Faro] ${message}`);

export const WEBPACK_PLUGIN_NAME = "FaroSourceMapUploaderPlugin";
export const ROLLUP_PLUGIN_NAME = "rollup-plugin-faro-source-map-uploader";

export const THIRTY_MB_IN_BYTES = 30 * 1024 * 1024;

export const JS_SOURCEMAP_PATTERN = /\.(js|ts|jsx|tsx|mjs|cjs)\.map$/;

export const cleanAppName = (appName: string) => {
  return appName.toUpperCase().replace(/[^A-Z0-9]/g, '_');
};

/**
 * Exports the bundleId to an environment variable file for use in the CLI
 * @param bundleId The bundleId to export
 * @param appName The name of the app
 * @param verbose Whether to log the export
 */
export const exportBundleIdToFile = (bundleId: string, appName: string, verbose?: boolean): void => {
  const appNameClean = cleanAppName(appName);
  const envVarName = `FARO_BUNDLE_ID_${appNameClean}`;
  const envFilePath = path.resolve(process.cwd(), `.env.${appNameClean}`);

  // Append the bundleId to the .env file
  fs.writeFileSync(envFilePath, `${envVarName}=${bundleId}\n`);

  if (verbose) {
    consoleInfoOrange(`Exported bundleId ${bundleId} to file ${envFilePath}`);
  }
};

crypto.randomUUID();

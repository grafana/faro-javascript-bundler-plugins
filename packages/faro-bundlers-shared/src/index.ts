import crypto from "crypto";
import fs from "fs";
import { create } from "tar";
import fetch from "cross-fetch";
import { ansi256 } from "ansis";

export interface FaroSourceMapUploaderPluginOptions {
  endpoint: string;
  appName: string;
  appId: string;
  orgId: string;
  outputFiles?: string[];
  bundleId?: string;
  keepSourcemaps?: boolean;
  gzipContents?: boolean;
  verbose?: boolean;
}

interface UploadSourceMapOptions {
  sourcemapEndpoint: string;
  orgId: string;
  filePath: string;
  filename: string;
  keepSourcemaps: boolean;
  verbose?: boolean;
}

interface UploadCompressedSourceMapsOptions {
  sourcemapEndpoint: string;
  orgId: string;
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
    orgId,
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
      "X-Scope-OrgID": orgId.toString(),
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
  const { sourcemapEndpoint, orgId, files, keepSourcemaps, verbose } = options;

  let sourcemapBuffer,
    success = true;

  sourcemapBuffer = await create({ gzip: true }, files);

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
      "X-Scope-OrgID": orgId.toString(),
    },
    body: sourcemapBuffer.read(),
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

export const faroBundleIdSnippet = (bundleId: string, appName: string) => {
  return `(function(){try{var g=typeof window!=="undefined"?window:typeof global!=="undefined"?global:typeof self!=="undefined"?self:{};g["__faroBundleId_${appName}"]="${bundleId}"}catch(l){}})();`;
};

export function randomString(length?: number): string {
  return crypto.randomBytes(length ?? 10).toString("hex");
}

export const consoleInfoOrange = (message: string) =>
  console.info(ansi256(214)`[Faro] ${message}`);

export const WEBPACK_PLUGIN_NAME = "FaroSourceMapUploaderPlugin";
export const ROLLUP_PLUGIN_NAME = "rollup-plugin-faro-source-map-uploader";

export const THIRTY_MB_IN_BYTES = 30 * 1024 * 1024;

crypto.randomUUID();

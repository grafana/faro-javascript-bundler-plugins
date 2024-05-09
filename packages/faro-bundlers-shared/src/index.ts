import crypto from "crypto";
import fs from "fs";
import zlib from "zlib";
import fetch from "cross-fetch";
import { ansi256 } from "ansis";

export interface FaroSourcemapUploaderPluginOptions {
  endpoint: string;
  appName: string;
  appId: string;
  outputFiles: string[];
  bundleId?: string;
  keepSourcemaps?: boolean;
  gzipContents?: boolean;
  verbose?: boolean;
}

interface UploadSourcemapOptions {
  sourcemapEndpoint: string;
  outputPath: string;
  filename: string;
  keepSourcemaps: boolean;
  gzip?: boolean;
  verbose?: boolean;
}

export const uploadSourceMap = async (options: UploadSourcemapOptions): Promise<boolean> => {
  const {
    sourcemapEndpoint,
    outputPath,
    keepSourcemaps,
    gzip,
    verbose,
    filename,
  } = options;
  let buffer, success = false;

  if (fs.existsSync(outputPath)) {
    buffer = fs.readFileSync(outputPath);
  }

  if (gzip && buffer) {
    verbose && consoleInfoOrange(`Gzipping ${filename}`);
    const gzipBuffer = zlib.gzipSync(buffer);
    buffer = gzipBuffer;
  }

  verbose && consoleInfoOrange(`Uploading ${filename} to ${sourcemapEndpoint}`);
  await fetch(sourcemapEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": gzip ? "application/gzip" : "application/json",
      "Content-Encoding": gzip ? "gzip" : "utf-8",
    },
    body: buffer,
  })
    .then((res) => {
      if (res.ok) {
        verbose &&
          consoleInfoOrange(`Uploaded ${filename} to ${sourcemapEndpoint}`);
        success = true;
      } else {
        consoleInfoOrange(
          `Upload of ${filename} failed with status: ${res.status}`
        );
      }

      // delete source map
      if (!keepSourcemaps && fs.existsSync(outputPath)) {
        verbose && consoleInfoOrange(`Deleting ${filename}`);
        fs.unlinkSync(outputPath);
      }
    })
    .catch((err) => console.error(err));

  return success;
};

export const faroBundleIdSnippet = (bundleId: string, appName: string) => {
  return `(function(){try{var g=typeof window!=="undefined"?window:typeof global!=="undefined"?global:typeof self!=="undefined"?self:{};g["__faroBundleId_${appName}"]="${bundleId}"}catch(l){}})()`;
};

export function randomString(length?: number): string {
  return crypto.randomBytes(length ?? 10).toString("hex");
}

export const consoleInfoOrange = (message: string) =>
  console.info(ansi256(214)`[Faro] ${message}`);

export const WEBPACK_PLUGIN_NAME = "FaroSourcemapUploaderPlugin";
export const ROLLUP_PLUGIN_NAME = "rollup-plugin-faro-sourcemap-uploader";

crypto.randomUUID();

import crypto from "crypto";

export interface FaroSourcemapUploaderPluginOptions {
  endpoint: string;
  appName: string;
  appId: string;
  outputFiles: string[];
  artifactId?: string;
}

export const faroArtifactIdSnippet = (artifactId: string, appName: string) => {
  return `(function(){try{var g=typeof window!=="undefined"?window:typeof global!=="undefined"?global:typeof self!=="undefined"?self:{},e=new Error();e&&(g.__faroArtifactIds=g.__faroArtifactIds?.set(e,"${artifactId}")||new Map([[e,"${artifactId}"]]));g["__faroArtifactId_${appName}"]="${artifactId}"}catch(l){}})();`;
};

export function randomString(length?: number): string {
  return crypto.randomBytes(length ?? 10).toString("hex");
}

export function stringToMD5(str: string): string {
  return crypto.createHash("md5").update(str).digest("hex");
}

export const WEBPACK_PLUGIN_NAME = "FaroSourcemapUploaderPlugin";
export const ROLLUP_PLUGIN_NAME = "rollup-plugin-faro-sourcemap-uploader";

crypto.randomUUID();

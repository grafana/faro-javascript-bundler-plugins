export interface FaroSourcemapUploaderPluginOptions {
  endpoint: string;
  appId: string;
  outputFiles: string[];
}

export const faroBuildIdSnippet = (buildId: string) => {
  return `(function (){var globalObj = (typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : typeof self !== 'undefined' ? self : {});globalObj.FARO_BUILD_ID = "${buildId}";})();`;
}

export const WEBPACK_PLUGIN_NAME = "FaroSourcemapUploaderPlugin";
export const ROLLUP_PLUGIN_NAME = "rollup-plugin-faro-sourcemap-uploader";

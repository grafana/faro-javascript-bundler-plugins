import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  faroBundleIdSnippet,
  consoleInfoOrange,
  uploadCompressedSourceMaps,
  uploadSourceMap,
  THIRTY_MB_IN_BYTES,
  ensureSourceMapFileProperty,
  modifySourceMapFileProperty,
  shouldProcessFile,
  isTruthyEnvVar,
  type FaroSourceMapUploaderPluginOptions,
} from '@grafana/faro-bundlers-shared';
import { shiftGeneratedLineNumbers } from './shiftSourceMap';
import { flattenMapForHermes } from './flattenMapForHermes';
import { resolveBundleId } from './resolveBundleId';
import { loadMetroDeps } from './metroDeps';

/**
 * Metro plugin options extend the shared Faro uploader options with Metro-specific fields.
 */
export type FaroMetroPluginOptions = FaroSourceMapUploaderPluginOptions & {
  /**
   * Base name of the generated bundle in the source map `file` field (e.g. `bundle.js`).
   * Defaults from the temporary map basename. Align with `releaseBundleFilename` in `@grafana/faro-react-native` if you change it.
   */
  sourceMapFile?: string;
  /**
   * Emit a Hermes-compatible "flat" source map where every mapping lives on generated
   * line 1 with `column` set to the absolute byte offset in the JS bundle. Hermes stack
   * frames always report `line=1, column=<byte offset>`, so a normal multi-line generated
   * map can't be looked up by the receiver. Defaults to `true` (Hermes is the default
   * runtime in modern React Native). Set `false` for JSC-only builds, which will fall
   * back to the legacy `+1` line shift.
   */
  hermes?: boolean;
};

export type MetroCustomSerializer = (
  entryPoint: string,
  prepend: readonly unknown[],
  graph: { dependencies: Map<string, { path: string }> },
  bundleOptions: Record<string, unknown>
) => Promise<string | { code: string; map: string }>;

export function getSortedModules(
  graph: { dependencies: Map<string, { path: string }> },
  createModuleId: (modulePath: string) => number
): { path: string }[] {
  const modules = [...graph.dependencies.values()];
  for (const m of modules) {
    createModuleId(m.path);
  }
  return modules.sort((a, b) => createModuleId(a.path) - createModuleId(b.path));
}

export function computeSkipUpload(pluginOptions: FaroMetroPluginOptions): boolean {
  if (isTruthyEnvVar(process.env.FARO_SKIP_SOURCEMAP_UPLOAD)) {
    return true;
  }
  if (pluginOptions.skipUpload === true) {
    return true;
  }
  if (pluginOptions.skipUpload === false) {
    return false;
  }
  return process.env.NODE_ENV === 'development';
}

async function computeModuleSourceMap(
  prepend: readonly unknown[],
  graph: { dependencies: Map<string, { path: string }> },
  bundleOptions: Record<string, unknown>
): Promise<string> {
  const { sourceMapStringNonBlocking } = loadMetroDeps();
  const createModuleId = bundleOptions.createModuleId as (modulePath: string) => number;
  return sourceMapStringNonBlocking(
    [...prepend, ...getSortedModules(graph, createModuleId)],
    {
      excludeSource: false,
      processModuleFilter: bundleOptions.processModuleFilter as (m: unknown) => boolean,
      shouldAddToIgnoreList: bundleOptions.shouldAddToIgnoreList as (m: unknown) => boolean,
      getSourceUrl: bundleOptions.getSourceUrl as (m: unknown) => string,
    }
  );
}

async function runDefaultMetroSerialize(
  entryPoint: string,
  prepend: readonly unknown[],
  graph: { dependencies: Map<string, { path: string }> },
  bundleOptions: Record<string, unknown>
): Promise<{ code: string; map: string }> {
  const { baseJSBundle, bundleToString } = loadMetroDeps();
  const bundle = baseJSBundle(entryPoint, prepend, graph, bundleOptions);
  const { code } = bundleToString(bundle);
  const map = await computeModuleSourceMap(prepend, graph, bundleOptions);
  return { code, map };
}

async function toCodeAndMap(
  raw: string | { code: string; map: string },
  prepend: readonly unknown[],
  graph: { dependencies: Map<string, { path: string }> },
  bundleOptions: Record<string, unknown>
): Promise<{ code: string; map: string }> {
  if (typeof raw === 'string') {
    const map = await computeModuleSourceMap(prepend, graph, bundleOptions);
    return { code: raw, map };
  }
  return raw;
}

async function maybeUploadMap(
  mapJsonString: string,
  bundleId: string,
  pluginOptions: FaroMetroPluginOptions,
  bundleDev: boolean
): Promise<void> {
  const skip = computeSkipUpload(pluginOptions);
  if (skip || bundleDev) {
    return;
  }
  const { apiKey } = pluginOptions;

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'faro-metro-'));
  const mapBase = (pluginOptions.sourceMapFile ?? 'bundle.js').replace(/\.map$/i, '');
  const mapPath = path.join(tmpDir, `${mapBase}.map`);
  try {
    fs.writeFileSync(mapPath, mapJsonString, 'utf8');
    ensureSourceMapFileProperty(mapPath, pluginOptions.verbose);
    if (pluginOptions.prefixPath) {
      modifySourceMapFileProperty(
        mapPath,
        pluginOptions.prefixPath,
        pluginOptions.verbose,
        pluginOptions.prefixPathBasenameOnly
      );
    }

    const endpointBase = `${pluginOptions.endpoint.replace(/\/$/, '')}/app/${pluginOptions.appId}/sourcemaps/`;
    const sourcemapEndpoint = `${endpointBase}${bundleId}`;
    const gzipContents = pluginOptions.gzipContents !== false;
    const keepSourcemaps = false;
    const maxSize =
      pluginOptions.maxUploadSize && pluginOptions.maxUploadSize > 0
        ? pluginOptions.maxUploadSize
        : THIRTY_MB_IN_BYTES;
    const stats = fs.statSync(mapPath);
    if (stats.size > maxSize) {
      consoleInfoOrange(
        `Source map exceeds maxUploadSize (${String(maxSize)} bytes); skipping upload`
      );
      return;
    }

    if (!shouldProcessFile(path.basename(mapPath), pluginOptions.outputFiles)) {
      pluginOptions.verbose &&
        consoleInfoOrange(
          `Skipping source map upload: ${path.basename(mapPath)} does not match JS source map name pattern (e.g. *.js.map or *.bundle.map).`
        );
      return;
    }

    if (gzipContents) {
      await uploadCompressedSourceMaps({
        sourcemapEndpoint,
        apiKey,
        stackId: pluginOptions.stackId,
        outputPath: tmpDir,
        files: [mapPath],
        keepSourcemaps,
        verbose: pluginOptions.verbose,
        proxy: pluginOptions.proxy,
      });
    } else {
      await uploadSourceMap({
        sourcemapEndpoint,
        apiKey,
        stackId: pluginOptions.stackId,
        filePath: mapPath,
        filename: path.basename(mapPath),
        keepSourcemaps,
        verbose: pluginOptions.verbose,
        proxy: pluginOptions.proxy,
      });
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

export function createFaroMetroCustomSerializer(
  previousSerializer: MetroCustomSerializer | null | undefined,
  pluginOptions: FaroMetroPluginOptions
): (
  entryPoint: string,
  prepend: readonly unknown[],
  graph: { dependencies: Map<string, { path: string }> },
  bundleOptions: Record<string, unknown>
) => Promise<{ code: string; map: string }> {
  return async (entryPoint, prepend, graph, bundleOptions) => {
    const bundleDev = Boolean(bundleOptions.dev);
    const skip = computeSkipUpload(pluginOptions);

    const inner = previousSerializer
      ? await previousSerializer(entryPoint, prepend, graph, bundleOptions)
      : await runDefaultMetroSerialize(entryPoint, prepend, graph, bundleOptions);

    const { code, map } = await toCodeAndMap(inner, prepend, graph, bundleOptions);

    const bundleId = resolveBundleId(pluginOptions.bundleId, bundleDev, skip);
    const snippet = faroBundleIdSnippet(bundleId, pluginOptions.appName);
    const newCode = `${snippet}\n${code}`;

    const mapObj = JSON.parse(map) as Record<string, unknown>;
    const useHermes = pluginOptions.hermes !== false;
    const rewritten = useHermes
      ? await flattenMapForHermes(mapObj, newCode, 1)
      : await shiftGeneratedLineNumbers(mapObj, 1);
    const mapFileBase = (pluginOptions.sourceMapFile ?? 'bundle.js').replace(/\.map$/i, '');
    if (rewritten.file == null || rewritten.file === '') {
      rewritten.file = mapFileBase;
    }
    const mapOut = JSON.stringify(rewritten);

    if (!skip && !bundleDev) {
      await maybeUploadMap(mapOut, bundleId, pluginOptions, bundleDev);
    }

    return { code: newCode, map: mapOut };
  };
}

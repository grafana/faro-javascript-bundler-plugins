import {
  faroBundleIdSnippet,
  type FaroSourceMapUploaderPluginOptions,
} from '@grafana/faro-bundlers-shared';
import { shiftGeneratedLineNumbers } from './shiftSourceMap';
import { flattenMapForHermes } from './flattenMapForHermes';
import { resolveBundleId } from './resolveBundleId';
import { loadMetroDeps } from './metroDeps';
import { isTruthyEnvVar } from './envFlags';

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
  /**
   * Android app module folder under `android/` (default `app`). Release variant only.
   * Override only when the application module is not named `app`.
   */
  androidModule?: string;
};

/**
 * Internal description of how this Metro invocation should treat the source map.
 *
 * `precompiled` means a downstream Hermes step will run after Metro and produce the
 * final composed map (Android/iOS release builds via Gradle/Xcode). In that case we
 * MUST keep the packager map in its multi-line shape so `compose-source-maps.js` can
 * consume it. Upload that composed map after the native build (`faro-upload-source-map`
 * shim → `faro-cli metro upload`, or the Gradle/Xcode hooks).
 *
 * `runtime` means Hermes runs as an interpreter on the JS bundle (no precompile, e.g.
 * dev mode or non-precompiled setups). Stack frames report `line=1, column=<byte>`
 * so we flatten the map for Hermes bytecode symbolication upstream.
 *
 * `jsc` means classic JSC: standard `(line, col)` stacks, line-shift only.
 */
type HermesMode = 'precompiled' | 'runtime' | 'jsc';

/**
 * Autodetect how Metro is being invoked so the plugin produces the right map shape
 * for Hermes precompile (`compose-source-maps.js`), Hermes interpreter, or JSC.
 *
 * Detection rules (most specific first):
 *   - `pluginOptions.hermes === false` → `jsc`.
 *   - `bundleOptions.dev === true` → `runtime` (dev server, Hermes interpreter).
 *   - `FARO_DISABLE_HERMES_PRECOMPILE` truthy → `runtime` (escape hatch for users
 *     who run Hermes without the precompile step in release).
 *   - otherwise (`dev: false`, `hermes !== false`) → `precompiled`. This is the
 *     default for `react-native run-android --variant=release` and Xcode "Release",
 *     because the React Native Gradle/Xcode scripts run `hermesc` + `compose-source-maps.js`
 *     after Metro.
 */
export function detectHermesMode(
  pluginOptions: FaroMetroPluginOptions,
  bundleOptions: Record<string, unknown>
): HermesMode {
  if (pluginOptions.hermes === false) {
    return 'jsc';
  }
  if (Boolean(bundleOptions.dev)) {
    return 'runtime';
  }
  if (isTruthyEnvVar(process.env.FARO_DISABLE_HERMES_PRECOMPILE)) {
    return 'runtime';
  }
  return 'precompiled';
}

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

    const bundleId = resolveBundleId(pluginOptions, bundleDev, skip, bundleOptions);
    const snippet = faroBundleIdSnippet(bundleId, pluginOptions.appName);
    const newCode = `${snippet}\n${code}`;

    const mapObj = JSON.parse(map) as Record<string, unknown>;
    const hermesMode = detectHermesMode(pluginOptions, bundleOptions);

    // For `precompiled`, Gradle/Xcode runs `hermesc` + `compose-source-maps.js` after Metro.
    // `compose-source-maps.js` walks the packager map per (line, col), so we MUST keep its
    // multi-line shape — flattening here would wipe `sources` from the final composed map.
    // For `runtime` (Hermes interpreter), stack frames are `(line=1, col=<byte>)` so we
    // flatten. For `jsc`, classic line/col stacks need only the +1 line shift.
    let rewritten: Record<string, unknown>;
    if (hermesMode === 'runtime') {
      rewritten = await flattenMapForHermes(mapObj, newCode, 1);
    } else {
      rewritten = await shiftGeneratedLineNumbers(mapObj, 1);
    }
    const mapFileBase = (pluginOptions.sourceMapFile ?? 'bundle.js').replace(/\.map$/i, '');
    if (rewritten.file == null || rewritten.file === '') {
      rewritten.file = mapFileBase;
    }
    const mapOut = JSON.stringify(rewritten);

    return { code: newCode, map: mapOut };
  };
}

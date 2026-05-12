import path from 'path';
import { createRequire } from 'module';

/* Metro subpaths are not in package "exports"; load internals via absolute paths from the installed package root. */
export function loadMetroDeps(): {
  baseJSBundle: (
    entryPoint: string,
    prepend: readonly unknown[],
    graph: Record<string, unknown>,
    options: Record<string, unknown>
  ) => unknown;
  bundleToString: (bundle: unknown) => { code: string; metadata?: unknown };
  sourceMapStringNonBlocking: (
    modules: readonly unknown[],
    options: Record<string, unknown>
  ) => Promise<string>;
} {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const metroPkg = require.resolve('metro/package.json') as string;
    const requireMetro = createRequire(metroPkg);
    const metroRoot = path.dirname(metroPkg);
    const baseJSBundle = requireMetro(
      path.join(metroRoot, 'src/DeltaBundler/Serializers/baseJSBundle.js')
    ).default as (...args: unknown[]) => unknown;
    const bundleToString = requireMetro(path.join(metroRoot, 'src/lib/bundleToString.js'))
      .default as (b: unknown) => { code: string };
    const sourceMapStringNonBlocking = requireMetro(
      path.join(metroRoot, 'src/DeltaBundler/Serializers/sourceMapString.js')
    ).sourceMapStringNonBlocking as (
      modules: readonly unknown[],
      options: Record<string, unknown>
    ) => Promise<string>;

    return { baseJSBundle, bundleToString, sourceMapStringNonBlocking };
  } catch {
    throw new Error(
      'Cannot load Metro internals. Add `metro` (see peer dependency of @grafana/faro-metro-plugin).'
    );
  }
}

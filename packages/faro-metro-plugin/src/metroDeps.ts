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
    // ESM consumers don't have a global `require`; anchor createRequire to this
    // module via __filename (CJS, including Jest's CJS test runtime) or
    // import.meta.url (ESM build at runtime). Direct eval keeps `import.meta`
    // out of the source AST so ts-jest's CJS compile stays happy — the eval
    // branch only runs in ESM, where direct eval inherits the module scope
    // and `import.meta` is syntactically valid.
    // eslint-disable-next-line no-eval -- see comment above; rollup warns but the warning is informational.
    const anchor: string =
      typeof __filename === 'string' ? __filename : (eval('import.meta.url') as string);
    const requireFromHere = createRequire(anchor);
    const metroPkg = requireFromHere.resolve('metro/package.json');
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

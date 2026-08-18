import { writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

import { defineConfig } from 'tsdown';

const cjsDeclarationFacade = `import FaroSourceMapUploaderPluginDefault from '../esm/index.mjs';
import type { WebpackFaroSourceMapUploaderPluginOptions } from '../esm/index.mjs';

declare class FaroSourceMapUploaderPlugin extends FaroSourceMapUploaderPluginDefault {}

declare namespace FaroSourceMapUploaderPlugin {
  export type { WebpackFaroSourceMapUploaderPluginOptions };
}

export = FaroSourceMapUploaderPlugin;
`;

export default defineConfig([
  {
    entry: {
      index: 'src/index.cjs.ts',
    },
    format: 'cjs',
    outDir: 'dist/cjs',
    target: 'esnext',
    sourcemap: true,
    clean: ['dist'],
    onSuccess(config) {
      const outDir = isAbsolute(config.outDir)
        ? config.outDir
        : join(config.cwd, config.outDir);

      writeFileSync(
        join(outDir, 'index.d.cts'),
        cjsDeclarationFacade
      );
    },
  },
  {
    format: 'esm',
    outDir: 'dist/esm',
    target: 'esnext',
    sourcemap: true,
    publint: true,
    attw: {
      level: 'error',
      profile: 'node16',
    },
  },
]);

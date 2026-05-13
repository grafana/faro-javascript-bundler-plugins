import { describe, test, expect } from '@jest/globals';
import { SourceMapConsumer, SourceMapGenerator, type RawSourceMap } from 'source-map';
import { flattenMapForHermes } from '../flattenMapForHermes';

/**
 * Build a tiny multi-line source map describing `code` and return the JSON form.
 * Each mapping list element is `[genLine, genCol, source, origLine, origCol, name?]`.
 */
function makeMap(
  file: string,
  mappings: Array<[number, number, string, number, number, string?]>,
  sourcesContent?: Record<string, string>
): Record<string, unknown> {
  const gen = new SourceMapGenerator({ file });
  for (const [gl, gc, src, ol, oc, name] of mappings) {
    gen.addMapping({
      generated: { line: gl, column: gc },
      original: { line: ol, column: oc },
      source: src,
      name,
    });
  }
  if (sourcesContent) {
    for (const [src, content] of Object.entries(sourcesContent)) {
      gen.setSourceContent(src, content);
    }
  }
  return JSON.parse(gen.toString()) as Record<string, unknown>;
}

describe('flattenMapForHermes', () => {
  test('moves every mapping to generated line 1 with absolute byte offsets', async () => {
    // Original code (what the map describes):
    //   line 1: "AAAA"   (bytes 0..3)
    //   line 2: "BBBB"   (bytes 5..8 after the \n at byte 4)
    //   line 3: "CCCCCC" (bytes 10..15)
    const map = makeMap('bundle.js', [
      [1, 0, 'foo.ts', 10, 1],
      [2, 4, 'foo.ts', 20, 2],
      [3, 6, 'bar.ts', 30, 3],
    ]);

    // Final bundle = "PREAMBLE\n" (9 bytes, \n at byte 8) + original code.
    // Original code line L starts at bundle byte:
    //   L=1 → 9, L=2 → 14, L=3 → 19
    const bundleCode = 'PREAMBLE\nAAAA\nBBBB\nCCCCCC';
    const flat = (await flattenMapForHermes(map, bundleCode, 1)) as unknown as RawSourceMap;

    // Result mappings must live on one line only (no `;` separators).
    expect(flat.mappings).not.toContain(';');

    // Verify each lookup resolves to the original source position.
    const consumer = await new SourceMapConsumer(flat);
    expect(consumer.originalPositionFor({ line: 1, column: 9 })).toMatchObject({
      source: 'foo.ts',
      line: 10,
      column: 1,
    });
    expect(consumer.originalPositionFor({ line: 1, column: 18 })).toMatchObject({
      source: 'foo.ts',
      line: 20,
      column: 2,
    });
    expect(consumer.originalPositionFor({ line: 1, column: 25 })).toMatchObject({
      source: 'bar.ts',
      line: 30,
      column: 3,
    });
  });

  test('honours custom preambleLines for multi-line preambles', async () => {
    const map = makeMap('bundle.js', [
      [1, 0, 'a.ts', 1, 0],
      [2, 2, 'a.ts', 2, 0],
    ]);

    // Two-line preamble: bundle line 3 (byte 6) is where original code line 1 starts.
    //   "AB\nCD\n" → preamble; \n at bytes 2 and 5; line 3 starts at byte 6
    //   "EE\nFF"  → original; line 1 starts at 6, line 2 starts at 9
    const bundleCode = 'AB\nCD\nEE\nFF';
    const flat = (await flattenMapForHermes(map, bundleCode, 2)) as unknown as RawSourceMap;

    const consumer = await new SourceMapConsumer(flat);
    expect(consumer.originalPositionFor({ line: 1, column: 6 })).toMatchObject({
      source: 'a.ts',
      line: 1,
      column: 0,
    });
    expect(consumer.originalPositionFor({ line: 1, column: 11 })).toMatchObject({
      source: 'a.ts',
      line: 2,
      column: 0,
    });
  });

  test('preserves sourcesContent and file fields', async () => {
    const map = makeMap(
      'bundle.js',
      [[1, 0, 'a.ts', 1, 0]],
      { 'a.ts': 'export const x = 1;\n' }
    );
    const flat = (await flattenMapForHermes(map, '!\nAAAA', 1)) as unknown as RawSourceMap;

    expect(flat.file).toBe('bundle.js');
    expect(flat.sourcesContent).toEqual(['export const x = 1;\n']);
  });

  test('preserves mapping name field', async () => {
    const map = makeMap('bundle.js', [
      [1, 0, 'a.ts', 5, 4, 'myFn'],
    ]);

    const flat = (await flattenMapForHermes(map, 'X\nAAA', 1)) as unknown as RawSourceMap;

    const consumer = await new SourceMapConsumer(flat);
    expect(consumer.originalPositionFor({ line: 1, column: 2 })).toMatchObject({
      source: 'a.ts',
      line: 5,
      column: 4,
      name: 'myFn',
    });
  });

  test('clamps when a mapping references a generated line past the bundle length', async () => {
    // Map claims a mapping on generated line 5, but the bundle only has 3 lines.
    // The function should clamp to the last known line rather than throw / corrupt.
    const map = makeMap('bundle.js', [[5, 1, 'a.ts', 1, 0]]);
    const bundleCode = 'X\nY\nZ'; // 3 lines, lineStart = [0, 2, 4]

    const flat = (await flattenMapForHermes(map, bundleCode, 1)) as unknown as RawSourceMap;

    const consumer = await new SourceMapConsumer(flat);
    // Without throwing: clamped to the last line start (4) + col (1) = 5.
    expect(consumer.originalPositionFor({ line: 1, column: 5 })).toMatchObject({
      source: 'a.ts',
      line: 1,
      column: 0,
    });
  });
});

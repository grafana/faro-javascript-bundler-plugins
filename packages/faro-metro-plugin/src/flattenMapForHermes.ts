import { SourceMapConsumer, SourceMapGenerator } from 'source-map';

/**
 * Rewrite `mapJson` so every mapping is on generated line 1, with `column` set to the
 * absolute byte offset of that mapping's position in `bundleCode`.
 *
 * Hermes stack frames are reported as `(line=1, column=<byte offset into the JS bundle>)`
 * regardless of newlines in the source. Standard Metro source maps key mappings by
 * `(generatedLine, generatedColumn)` where line is newline-counted, so a receiver looking
 * up `(1, byteOffset)` against an un-flattened map misses everything past the first line.
 *
 * Assumes `mapJson` describes the original code Metro produced (pre-preamble) and
 * `bundleCode` is the final bundle (`${preamble}\n${code}` as composed in `serialize.ts`).
 * `preambleLines` is the number of bundle lines the preamble occupies before the original
 * code starts — the default of 1 matches the snippet+newline pattern emitted by
 * `createFaroMetroCustomSerializer`.
 */
export async function flattenMapForHermes(
  mapJson: Record<string, unknown>,
  bundleCode: string,
  preambleLines = 1
): Promise<Record<string, unknown>> {
  // Byte offset of the start of each line in the final bundle. lineStart[i] is the
  // start of bundle line i+1 (0-indexed array); lineStart[0] is always 0.
  const lineStart: number[] = [0];
  for (let i = 0; i < bundleCode.length; i++) {
    if (bundleCode.charCodeAt(i) === 10) {
      lineStart.push(i + 1);
    }
  }

  const asInput = mapJson as unknown as Parameters<typeof SourceMapConsumer.with>[0];

  return SourceMapConsumer.with(asInput, null, async (consumer) => {
    const generator = new SourceMapGenerator({
      file: mapJson.file as string | undefined,
      sourceRoot: mapJson.sourceRoot as string | undefined,
    });

    consumer.eachMapping((m) => {
      if (m.source == null) {
        return;
      }
      // Original code line L lives on bundle line L + preambleLines; lineStart is
      // 0-indexed so the byte offset of that line's start is at index
      // (preambleLines + L - 1). Clamp to the table to be defensive.
      const idx = Math.min(preambleLines + m.generatedLine - 1, lineStart.length - 1);
      const absoluteCol = lineStart[idx] + m.generatedColumn;
      generator.addMapping({
        generated: { line: 1, column: absoluteCol },
        original: {
          line: m.originalLine ?? 1,
          column: m.originalColumn ?? 0,
        },
        source: m.source,
        name: m.name ?? undefined,
      });
    });

    for (const source of consumer.sources) {
      const content = consumer.sourceContentFor(source);
      if (content !== null) {
        generator.setSourceContent(source, content);
      }
    }

    return generator.toJSON() as unknown as Record<string, unknown>;
  });
}

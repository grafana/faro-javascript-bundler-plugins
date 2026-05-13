import { SourceMapConsumer, SourceMapGenerator } from 'source-map';

/**
 * Walk `s` once and build:
 *   - `lineStartUtf16[i]`: UTF-16 code unit index of line (i+1)'s first character.
 *   - `utf16ToUtf8[i]`: UTF-8 byte offset of the position that UTF-16 code unit `i` represents.
 *
 * Used to translate a Metro source map's `(generatedLine, generatedColumn)` — where
 * columns are 0-based UTF-16 code unit indices per the source-map spec — into the
 * UTF-8 byte offsets Hermes uses for stack frame columns. For an all-ASCII bundle the
 * two tables collapse to a single line-start array; the bookkeeping only matters once
 * the bundle contains non-Latin string literals, emoji, or other multi-byte content.
 */
function buildOffsetTables(s: string): { lineStartUtf16: number[]; utf16ToUtf8: number[] } {
  const lineStartUtf16: number[] = [0];
  const utf16ToUtf8: number[] = new Array(s.length + 1);
  let utf8 = 0;
  let i = 0;
  while (i < s.length) {
    utf16ToUtf8[i] = utf8;
    const c = s.charCodeAt(i);
    if (c === 0x0a) {
      utf8 += 1;
      i += 1;
      lineStartUtf16.push(i);
    } else if (c < 0x80) {
      utf8 += 1;
      i += 1;
    } else if (c < 0x800) {
      utf8 += 2;
      i += 1;
    } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      // High surrogate paired with a following low surrogate encodes one Unicode
      // codepoint in 4 UTF-8 bytes. Record the byte offset for the low surrogate's
      // position too so columns landing on either half resolve identically.
      utf16ToUtf8[i + 1] = utf8;
      utf8 += 4;
      i += 2;
    } else {
      utf8 += 3;
      i += 1;
    }
  }
  utf16ToUtf8[s.length] = utf8;
  return { lineStartUtf16, utf16ToUtf8 };
}

/**
 * Rewrite `mapJson` so every mapping is on generated line 1, with `column` set to the
 * absolute UTF-8 byte offset of that mapping's position in `bundleCode`.
 *
 * Hermes stack frames are reported as `(line=1, column=<UTF-8 byte offset>)` regardless
 * of newlines in the source. Standard Metro source maps key mappings by
 * `(generatedLine, generatedColumn)` where line is newline-counted and column is a
 * UTF-16 code unit index (per the source-map spec). Without this rewrite, a receiver
 * looking up `(1, byteOffset)` against an un-flattened map misses everything past the
 * first line; with non-ASCII content in the bundle, raw UTF-16 indices would also
 * drift from Hermes' byte offsets.
 *
 * Assumes `mapJson` describes the original code Metro produced (pre-preamble) and
 * `bundleCode` is the final bundle (`${preamble}\n${code}` as composed in
 * `serialize.ts`). `preambleLines` is the number of bundle lines the preamble occupies
 * before the original code starts — the default of 1 matches the snippet+newline
 * pattern emitted by `createFaroMetroCustomSerializer`.
 */
export async function flattenMapForHermes(
  mapJson: Record<string, unknown>,
  bundleCode: string,
  preambleLines = 1
): Promise<Record<string, unknown>> {
  const { lineStartUtf16, utf16ToUtf8 } = buildOffsetTables(bundleCode);

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
      // Original code line L lives on bundle line L + preambleLines. `lineStartUtf16`
      // is 0-indexed; the UTF-16 start of that bundle line is at index
      // (preambleLines + L - 1). Clamp to the table to be defensive against malformed
      // or trailing mappings that reference a line past the bundle's end.
      const lineIdx = Math.min(preambleLines + m.generatedLine - 1, lineStartUtf16.length - 1);
      const utf16Pos = Math.min(
        lineStartUtf16[lineIdx] + m.generatedColumn,
        utf16ToUtf8.length - 1
      );
      const absoluteCol = utf16ToUtf8[utf16Pos];
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
      // Pass `nullOnMissing=true` so sources without embedded content return `null`
      // instead of throwing — Metro can emit maps with partial `sourcesContent`, and
      // we want those to flatten without aborting.
      const content = consumer.sourceContentFor(source, true);
      if (content !== null) {
        generator.setSourceContent(source, content);
      }
    }

    return generator.toJSON() as unknown as Record<string, unknown>;
  });
}

import { SourceMapConsumer, SourceMapGenerator } from 'source-map';

/** Shifts all generated line numbers in `mapJson` by `lineOffset` (for prepended preamble lines). */
export async function shiftGeneratedLineNumbers(
  mapJson: Record<string, unknown>,
  lineOffset: number
): Promise<Record<string, unknown>> {
  if (lineOffset === 0) {
    return mapJson;
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
      generator.addMapping({
        generated: {
          line: m.generatedLine + lineOffset,
          column: m.generatedColumn,
        },
        original: {
          line: m.originalLine ?? 1,
          column: m.originalColumn ?? 0,
        },
        source: m.source,
        name: m.name ?? undefined,
      });
    });

    for (const source of consumer.sources) {
      const content = consumer.sourceContentFor(source, /* nullOnMissing */ true);
      if (content !== null) {
        generator.setSourceContent(source, content);
      }
    }

    return generator.toJSON() as unknown as Record<string, unknown>;
  });
}

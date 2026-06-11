import { buildZipFromEntries } from '../../nativeSymbolsByAbi';

/** Builds a minimal AGP-style multi-ABI zip for unit tests. */
export function buildTestAgpZip(entries: Array<[string, Buffer]>): Buffer {
  return buildZipFromEntries(entries);
}

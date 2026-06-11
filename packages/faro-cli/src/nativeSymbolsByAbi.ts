import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { deflateRawSync, inflateRawSync } from 'zlib';

/** AGP ABI folder names accepted on upload. */
export const ALLOWED_NATIVE_ABIS = ['arm64-v8a', 'armeabi-v7a', 'x86_64', 'x86', 'riscv64'] as const;

export type NativeAbi = (typeof ALLOWED_NATIVE_ABIS)[number];

export interface AbiZipArtifact {
  abi: NativeAbi;
  zipPath: string;
  bytes: number;
}

interface ZipEntry {
  name: string;
  data: Buffer;
}

/** Reads AGP native-debug-symbols.zip entries ending in .so or .so.dbg. */
export function readAgpNativeZip(zipBytes: Buffer): ZipEntry[] {
  const entries: ZipEntry[] = [];
  for (const entry of parseZipEntries(zipBytes)) {
    const lower = entry.name.toLowerCase();
    if (lower.endsWith('.so') || lower.endsWith('.so.dbg')) {
      entries.push(entry);
    }
  }
  return entries;
}

/** Groups zip entries by ABI folder and normalizes .so.dbg → .so inside {abi}/ paths. */
export function groupEntriesByAbi(entries: ZipEntry[]): Map<NativeAbi, Map<string, Buffer>> {
  const byAbi = new Map<NativeAbi, Map<string, Buffer>>();

  for (const entry of entries) {
    const abi = abiFromZipPath(entry.name);
    if (!abi) {
      continue;
    }
    let libName = path.basename(entry.name);
    if (libName.endsWith('.so.dbg')) {
      libName = libName.slice(0, -4);
    }
    if (!libName.endsWith('.so')) {
      continue;
    }
    const zipPath = `${abi}/${libName}`;
    if (!byAbi.has(abi)) {
      byAbi.set(abi, new Map());
    }
    byAbi.get(abi)!.set(zipPath, entry.data);
  }

  return byAbi;
}

/** Builds one Deflate-compressed zip per ABI. */
export function buildAbiZip(libs: Map<string, Buffer>): Buffer {
  const entries = [...libs.entries()].sort(([a], [b]) => a.localeCompare(b));
  return createDeflateZip(entries);
}

/**
 * Splits AGP native-debug-symbols.zip into per-ABI zips under outputDir.
 * Returns artifacts sorted by ABI name.
 */
export function packNativeSymbolsByAbi(agpZipPath: string, outputDir: string): AbiZipArtifact[] {
  const zipBytes = fs.readFileSync(agpZipPath);
  const grouped = groupEntriesByAbi(readAgpNativeZip(zipBytes));
  fs.mkdirSync(outputDir, { recursive: true });

  const artifacts: AbiZipArtifact[] = [];
  for (const abi of ALLOWED_NATIVE_ABIS) {
    const libs = grouped.get(abi);
    if (!libs || libs.size === 0) {
      continue;
    }
    const outPath = path.join(outputDir, `${abi}.zip`);
    const payload = buildAbiZip(libs);
    fs.writeFileSync(outPath, payload);
    artifacts.push({ abi, zipPath: outPath, bytes: payload.length });
  }

  if (artifacts.length === 0) {
    throw new Error(`no native .so entries found in ${agpZipPath}`);
  }

  // Sort artifacts by ABI name to match documented behavior
  return artifacts.sort((a, b) => a.abi.localeCompare(b.abi));
}

function abiFromZipPath(name: string): NativeAbi | null {
  const clean = name.replace(/\\/g, '/');
  const parts = clean.split('/').filter(Boolean);
  if (parts.length < 2) {
    return null;
  }
  let candidate = parts[parts.length - 2];
  if (candidate === 'obj' && parts.length >= 3) {
    candidate = parts[parts.length - 3];
  }
  return ALLOWED_NATIVE_ABIS.includes(candidate as NativeAbi) ? (candidate as NativeAbi) : null;
}

function parseZipEntries(buffer: Buffer): ZipEntry[] {
  const eocdOffset = findEocdOffset(buffer);
  if (eocdOffset < 0) {
    throw new Error('invalid zip: EOCD not found');
  }

  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirOffset = buffer.readUInt32LE(eocdOffset + 16);
  const entries: ZipEntry[] = [];

  let offset = centralDirOffset;
  for (let i = 0; i < totalEntries; i++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error('invalid zip central directory');
    }
    const compression = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLen = buffer.readUInt16LE(offset + 28);
    const extraLen = buffer.readUInt16LE(offset + 30);
    const commentLen = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLen).toString('utf8');
    offset += 46 + nameLen + extraLen + commentLen;

    const localNameLen = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLen = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);

    let data: Buffer;
    if (compression === 0) {
      data = Buffer.from(compressed);
    } else if (compression === 8) {
      data = inflateRawCompat(compressed, uncompressedSize);
    } else {
      throw new Error(`unsupported zip compression ${compression} for ${name}`);
    }

    entries.push({ name, data });
  }

  return entries;
}

function inflateRawCompat(compressed: Buffer, expectedSize: number): Buffer {
  const out = inflateRawSync(compressed);
  if (expectedSize > 0 && out.length !== expectedSize) {
    throw new Error(`unexpected inflated size for zip entry: got ${out.length}, want ${expectedSize}`);
  }
  return out;
}

function findEocdOffset(buffer: Buffer): number {
  const minEocd = 22;
  for (let i = buffer.length - minEocd; i >= 0; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      return i;
    }
  }
  return -1;
}

/** @internal Exported for unit tests — builds a deflate zip from path/content pairs. */
export function buildZipFromEntries(entries: Array<[string, Buffer]>): Buffer {
  return createDeflateZip(entries);
}

function createDeflateZip(entries: Array<[string, Buffer]>): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const [name, data] of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const compressed = deflateRawSync(data);
    const crc = crc32(data);

    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    nameBuf.copy(local, 30);

    const centralEntry = Buffer.alloc(46 + nameBuf.length);
    centralEntry.writeUInt32LE(0x02014b50, 0);
    centralEntry.writeUInt16LE(20, 4);
    centralEntry.writeUInt16LE(20, 6);
    centralEntry.writeUInt16LE(8, 8);
    centralEntry.writeUInt16LE(0, 10);
    centralEntry.writeUInt16LE(0, 12);
    centralEntry.writeUInt32LE(crc, 16);
    centralEntry.writeUInt32LE(compressed.length, 20);
    centralEntry.writeUInt32LE(data.length, 24);
    centralEntry.writeUInt16LE(nameBuf.length, 28);
    centralEntry.writeUInt16LE(0, 30);
    centralEntry.writeUInt16LE(0, 32);
    centralEntry.writeUInt16LE(0, 34);
    centralEntry.writeUInt16LE(0, 36);
    centralEntry.writeUInt32LE(0, 38);
    centralEntry.writeUInt32LE(offset, 42);
    nameBuf.copy(centralEntry, 46);

    parts.push(local, compressed);
    central.push(centralEntry);
    offset += local.length + compressed.length;
  }

  const centralSize = central.reduce((sum, b) => sum + b.length, 0);
  const centralStart = offset;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralStart, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...parts, ...central, eocd]);
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Stable content hash helper for tests/logging. */
export function sha256Hex(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

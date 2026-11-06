import fs from 'fs';
import os from 'os';
import path from 'path';
import { crc32, inflateRawSync } from 'zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildAbiZip, groupEntriesByAbi, packNativeSymbolsByAbi, readAgpNativeZip } from '../nativeSymbolsByAbi';
import { buildTestAgpZip } from './helpers/buildTestAgpZip';

/**
 * Reads a zip the way a normal unzipper does: honor the compression method in
 * the central directory, then check the CRC of the recovered bytes.
 */
function readStandardZip(zip: Buffer): Array<{ name: string; data: Buffer }> {
  const eocd = findEocd(zip);
  const entryCount = zip.readUInt16LE(eocd + 10);
  let offset = zip.readUInt32LE(eocd + 16);
  const entries: Array<{ name: string; data: Buffer }> = [];

  for (let i = 0; i < entryCount; i++) {
    if (zip.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error('invalid zip central directory');
    }
    const method = zip.readUInt16LE(offset + 10);
    const expectedCrc = zip.readUInt32LE(offset + 16);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const uncompressedSize = zip.readUInt32LE(offset + 24);
    const nameLen = zip.readUInt16LE(offset + 28);
    const extraLen = zip.readUInt16LE(offset + 30);
    const commentLen = zip.readUInt16LE(offset + 32);
    const localOffset = zip.readUInt32LE(offset + 42);
    const name = zip.subarray(offset + 46, offset + 46 + nameLen).toString('utf8');
    offset += 46 + nameLen + extraLen + commentLen;

    if (zip.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error(`invalid local header for ${name}`);
    }
    const localMethod = zip.readUInt16LE(localOffset + 8);
    if (localMethod !== method) {
      throw new Error(`compression method mismatch for ${name}`);
    }
    const localNameLen = zip.readUInt16LE(localOffset + 26);
    const localExtraLen = zip.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const compressed = zip.subarray(dataStart, dataStart + compressedSize);

    let data: Buffer;
    if (method === 0) {
      if (compressedSize !== uncompressedSize) {
        throw new Error(`entry ${name} is marked uncompressed but the stored size does not match`);
      }
      data = Buffer.from(compressed);
    } else if (method === 8) {
      data = inflateRawSync(compressed);
    } else {
      throw new Error(`unsupported compression method ${method} for ${name}`);
    }

    if (data.length !== uncompressedSize || (crc32(data) >>> 0) !== expectedCrc) {
      throw new Error(`CRC mismatch for ${name}`);
    }
    entries.push({ name, data });
  }

  return entries;
}

function findEocd(zip: Buffer): number {
  for (let i = zip.length - 22; i >= 0; i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      return i;
    }
  }
  throw new Error('invalid zip: EOCD not found');
}

describe('nativeSymbolsByAbi', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'faro-native-abi-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('groups AGP zip entries by ABI and normalizes .so.dbg', () => {
    const agp = buildTestAgpZip([
      ['arm64-v8a/libfoo.so.dbg', Buffer.from('elf-a')],
      ['x86_64/libfoo.so', Buffer.from('elf-x')],
    ]);

    const grouped = groupEntriesByAbi(readAgpNativeZip(agp));
    expect([...grouped.keys()].sort()).toEqual(['arm64-v8a', 'x86_64']);
    expect(grouped.get('arm64-v8a')!.has('arm64-v8a/libfoo.so')).toBe(true);
  });

  it('packNativeSymbolsByAbi writes one zip per ABI', () => {
    const agpPath = path.join(tempDir, 'native-debug-symbols.zip');
    fs.writeFileSync(
      agpPath,
      buildTestAgpZip([
        ['arm64-v8a/liba.so', Buffer.alloc(1024, 1)],
        ['armeabi-v7a/libb.so', Buffer.alloc(1024, 2)],
        ['x86_64/libc.so', Buffer.alloc(1024, 3)],
        ['x86/libd.so', Buffer.alloc(1024, 4)],
      ]),
    );

    const outDir = path.join(tempDir, 'abi-out');
    const artifacts = packNativeSymbolsByAbi(agpPath, outDir);

    expect(artifacts).toHaveLength(4);
    expect(artifacts.every((a) => a.bytes > 0 && a.bytes < 45 * 1024 * 1024)).toBe(true);
    for (const artifact of artifacts) {
      expect(fs.existsSync(artifact.zipPath)).toBe(true);
    }
    
    // Verify artifacts are sorted by ABI name
    const abis = artifacts.map((a) => a.abi);
    expect(abis).toEqual(['arm64-v8a', 'armeabi-v7a', 'x86', 'x86_64']);
  });

  it('buildAbiZip produces parseable zip output', () => {
    const zip = buildAbiZip(
      new Map([
        ['arm64-v8a/libdemo.so', Buffer.from([0x7f, 0x45, 0x4c, 0x46])],
      ]),
    );
    expect(zip.length).toBeGreaterThan(0);
    const entries = readAgpNativeZip(zip);
    expect(entries.some((e) => e.name === 'arm64-v8a/libdemo.so')).toBe(true);
  });

  it('buildAbiZip entries open with a standard zip reader', () => {
    const name = 'arm64-v8a/libdemo.so';
    const original = Buffer.concat([
      Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]),
      Buffer.alloc(64, 0xab),
    ]);
    const zip = buildAbiZip(new Map([[name, original]]));

    expect(readStandardZip(zip)).toEqual([{ name, data: original }]);
  });
});

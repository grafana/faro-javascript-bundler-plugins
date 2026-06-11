import fs from 'fs';
import os from 'os';
import path from 'path';

import { buildAbiZip, groupEntriesByAbi, packNativeSymbolsByAbi, readAgpNativeZip } from '../nativeSymbolsByAbi';
import { buildTestAgpZip } from './helpers/buildTestAgpZip';

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
});

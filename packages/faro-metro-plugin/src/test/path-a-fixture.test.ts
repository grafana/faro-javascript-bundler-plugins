import path from 'path';
import fs from 'fs';
import { describe, expect, test } from 'vitest';
import { fileURLToPath } from 'url';

const dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Path A (plan §1b): assert a release `.map` from `react-native bundle` shape
 * parses without running the full RN CLI in unit tests.
 */
describe('Path A release source map fixture', () => {
  test('parses as JSON v3 with non-empty sources and bundle file field', () => {
    const mapPath = path.join(
      dirname,
      'fixtures',
      'path-a-release.index.android.bundle.map'
    );
    const raw = fs.readFileSync(mapPath, 'utf8');
    const parsed = JSON.parse(raw) as {
      version: number;
      sources: string[];
      file: string;
    };

    expect(parsed.version).toBe(3);
    expect(Array.isArray(parsed.sources)).toBe(true);
    expect(parsed.sources.length).toBeGreaterThan(0);
    expect(typeof parsed.file).toBe('string');
    expect(parsed.file).toBe('index.android.bundle');
  });
});

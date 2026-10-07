import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveApiKey } from '../apiKey';

const originalApiKey = process.env.FARO_SOURCEMAP_API_KEY;

beforeEach(() => {
  delete process.env.FARO_SOURCEMAP_API_KEY;
});

afterEach(() => {
  if (originalApiKey === undefined) {
    delete process.env.FARO_SOURCEMAP_API_KEY;
  } else {
    process.env.FARO_SOURCEMAP_API_KEY = originalApiKey;
  }
});

describe('resolveApiKey', () => {
  it('falls back to FARO_SOURCEMAP_API_KEY', () => {
    process.env.FARO_SOURCEMAP_API_KEY = 'env-key';

    expect(resolveApiKey()).toBe('env-key');
  });

  it('prefers the CLI option', () => {
    process.env.FARO_SOURCEMAP_API_KEY = 'env-key';

    expect(resolveApiKey('cli-key')).toBe('cli-key');
  });

  it('ignores empty values', () => {
    process.env.FARO_SOURCEMAP_API_KEY = '  ';

    expect(resolveApiKey('  ')).toBeUndefined();
  });
});

/**
 * True for common env flag values: "1", "true" (case-insensitive, whitespace-trimmed).
 * Used for example with `FARO_SKIP_SOURCEMAP_UPLOAD`.
 */
export function isTruthyEnvVar(value: string | undefined): boolean {
  if (value == null) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true';
}

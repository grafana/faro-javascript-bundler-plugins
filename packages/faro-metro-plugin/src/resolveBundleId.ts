import crypto from 'crypto';
import { randomString, consoleInfoOrange } from '@grafana/faro-bundlers-shared';

const MAX_BUNDLE_ID_LEN = 512;

export function normalizeBundleIdLength(id: string): string {
  if (id.length <= MAX_BUNDLE_ID_LEN) {
    return id;
  }
  return crypto.createHash('sha256').update(id, 'utf8').digest('hex').slice(0, 32);
}

export function resolveBundleId(
  explicitFromOptions: string | undefined,
  bundleDev: boolean,
  skipUpload: boolean
): string {
  const explicit = explicitFromOptions ?? process.env.FARO_BUNDLE_ID;
  if (explicit) {
    return normalizeBundleIdLength(explicit);
  }
  if (bundleDev || skipUpload) {
    return normalizeBundleIdLength(`dev-${randomString(6)}`);
  }
  consoleInfoOrange(
    'FARO_BUNDLE_ID is not set; using an ephemeral id for this build. Set FARO_BUNDLE_ID so uploads match meta.app.bundleId.'
  );
  return normalizeBundleIdLength(String(Date.now()) + randomString(5));
}

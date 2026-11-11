/** Encoded Android release bundle id: `{applicationId}@{versionCode}@{versionName}`. */
export function formatBundleId(
  applicationId: string,
  versionCode: string,
  versionName: string
): string {
  if (applicationId.includes('@')) {
    throw new Error(`applicationId cannot contain '@': ${applicationId}`);
  }
  if (/[/\\]/.test(applicationId)) {
    throw new Error(`applicationId cannot contain path separators: ${applicationId}`);
  }
  if (versionName.includes('@')) {
    throw new Error(`versionName cannot contain '@': ${versionName}`);
  }
  if (/[/\\]/.test(versionName)) {
    throw new Error(`versionName cannot contain path separators: ${versionName}`);
  }
  if (!/^\d+$/.test(versionCode)) {
    throw new Error(`versionCode must be an integer: ${versionCode}`);
  }
  return `${applicationId}@${versionCode}@${versionName}`;
}

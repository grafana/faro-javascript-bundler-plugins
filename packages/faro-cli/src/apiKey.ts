export const resolveApiKey = (apiKey?: string): string | undefined =>
  apiKey?.trim() || process.env.FARO_SOURCEMAP_API_KEY?.trim() || undefined;

import {
  createFaroMetroCustomSerializer,
  type FaroMetroPluginOptions,
  type MetroCustomSerializer,
} from './serialize';

export type { FaroMetroPluginOptions, MetroCustomSerializer };

/**
 * Wraps a Metro config to inject the Faro bundle id preamble, adjust source maps, and (for release bundles) upload the JS source map to the Grafana KWL source map API.
 *
 * When using `@sentry/react-native` Metro integration, apply **Sentry outside** and **Faro inside** so the preamble stays at the start of the bundle, for example:
 * `mergeConfig(getDefaultConfig(__dirname), withSentryConfig(withFaroConfig({}, faroOpts)))` — consult the Sentry and RN docs for your versions.
 */
export default function withFaroConfig(
  metroConfig: Record<string, unknown>,
  faroOptions: FaroMetroPluginOptions
): Record<string, unknown> {
  const serializer = metroConfig.serializer as Record<string, unknown> | undefined;
  const previous = serializer?.customSerializer as MetroCustomSerializer | undefined;

  return {
    ...metroConfig,
    serializer: {
      ...serializer,
      customSerializer: createFaroMetroCustomSerializer(
        previous ?? null,
        faroOptions
      ),
    },
  };
}

export { createFaroMetroCustomSerializer, computeSkipUpload, getSortedModules } from './serialize';
export { shiftGeneratedLineNumbers } from './shiftSourceMap';
export { flattenMapForHermes } from './flattenMapForHermes';
export { normalizeBundleIdLength, resolveBundleId } from './resolveBundleId';

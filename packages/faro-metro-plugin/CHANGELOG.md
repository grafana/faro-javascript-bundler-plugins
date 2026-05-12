# Changelog

## 0.1.0

- Initial release: Metro `customSerializer` wrapper, Faro bundle id preamble, source map line shift, release upload to the Faro source map API, optional `sourceMapFile` for the generated map’s `file` field.
- Unit tests cover release `sourcemapEndpoint` (`…/app/{appId}/sourcemaps/{bundleId}`), gzip vs non-gzip upload helpers, hashed bundle ids over the length limit, non-success upload handling, and a Path A–style source map fixture parse check.
- When Metro omits the source map `file` field, the serializer sets it from `sourceMapFile` (default `bundle.js`) so emitted maps and uploads stay aligned with the RN SDK’s `releaseBundleFilename`.
- With `verbose: true`, log when upload is skipped because the map filename did not match the shared JS source map pattern (fixed in `@grafana/faro-bundlers-shared` for `*.bundle.map` / `*.jsbundle.map`).

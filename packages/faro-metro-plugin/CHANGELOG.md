# Changelog

## 0.1.0

- Initial release of the plugin, including a Metro `customSerializer` wrapper, Faro bundle id preamble, Hermes/source map line shift, optional `sourceMapFile` so emitted maps stay aligned with the React Native SDK’s `releaseBundleFilename`, and optional verbose logging when upload is skipped because the map filename does not match the expected bundle map patterns.
- Upload composed Metro/Hermes release source maps with `faro-cli metro upload` from `@grafana/faro-cli`; the `faro-upload-source-map` binary delegates to it for Gradle hooks and scripts.

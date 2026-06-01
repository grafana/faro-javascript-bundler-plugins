# Changelog

## [0.2.0](https://github.com/grafana/faro-javascript-bundler-plugins/compare/faro-metro-plugin-v0.1.0...faro-metro-plugin-v0.2.0) (2026-06-01)


### Features

* add faro metro plugin support for react native ([#541](https://github.com/grafana/faro-javascript-bundler-plugins/issues/541)) ([bbde065](https://github.com/grafana/faro-javascript-bundler-plugins/commit/bbde065c76cc8de711c4497a1c6b889d6981e548))


### Bug Fixes

* forcing commit to publish new versions and resolve CVEs ([#427](https://github.com/grafana/faro-javascript-bundler-plugins/issues/427)) ([7595951](https://github.com/grafana/faro-javascript-bundler-plugins/commit/759595156942da9159016afe1f23ac47dbec0ee8))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @grafana/faro-bundlers-shared bumped from ^0.10.0 to ^0.11.0

## 0.1.0

- Initial release of the plugin, including a Metro `customSerializer` wrapper, Faro bundle id preamble, Hermes/source map line shift, optional `sourceMapFile` so emitted maps stay aligned with the React Native SDK’s `releaseBundleFilename`, and optional verbose logging when upload is skipped because the map filename does not match the expected bundle map patterns.
- Upload composed Metro/Hermes release source maps with `faro-cli metro upload` from `@grafana/faro-cli`; the `faro-upload-source-map` binary delegates to it for Gradle hooks and scripts.

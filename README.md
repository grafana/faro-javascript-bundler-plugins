# Faro JavaScript bundler plugins

A collection of plugins for various JavaScript bundlers. Used in conjunction with the [Faro Web SDK](https://github.com/grafana/faro-web-sdk) to unlock additional features in [Grafana Cloud Frontend Observability](https://grafana.com/docs/grafana-cloud/monitor-applications/frontend-observability/).

## Getting started

The Faro JavaScript bundler plugins work with the [Faro Web SDK](https://github.com/grafana/faro-web-sdk) and [Grafana Cloud Frontend Observability](https://grafana.com/products/cloud/frontend-observability-for-real-user-monitoring/). To use these bundler plugins, you must first have instrumented your JavaScript application with Faro and be sending your telemetry data to a Faro Collector endpoint in Grafana Cloud. Follow the Frontend Observability [quickstart guide](https://grafana.com/docs/grafana-cloud/monitor-applications/frontend-observability/quickstart/javascript/) to get started.

After you have an instrumented JavaScript application sending data to Grafana Cloud, you are ready to get started.

## Installation

To install the Faro JavaScript bundler plugins, use the package manager of your choice.

### Webpack

To install the Webpack plugin with `npm`, run:

```bash
npm install @grafana/faro-bundler-plugin-webpack
```

To install the Webpack plugin with `yarn`, run:

```bash
yarn add @grafana/faro-bundler-plugin-webpack
```

### Rollup/Vite

Rollup and Vite are both supported by the same plugin.

To install the Rollup/Vite plugin with `npm`, run:

```bash
npm install @grafana/faro-bundler-plugin-rollup
```

To install the Rollup/Vite plugin with `yarn`, run:

```bash
yarn add @grafana/faro-bundler-plugin-rollup
```

## Obtaining API key

!! TODO - Add instructions on how to obtain API key !!

## Usage

Details of how to use the plugins with your bundler reside in the Frontend Observability plugin under the "Settings" -> "Web SDK Config" tab after clicking into your instrumented app.

That tab includes the necessary configuration for the Faro JavaScript bundler plugins, including the `appName`, `appId`, and `endpoint` values that you need for the plugins to work with your app. The details provided below are general instructions for how to use the plugins with your bundler.

### Webpack

To use the Webpack plugin, add the following to your `webpack.config.js`:

```javascript
// other imports
import FaroSourceMapUploaderPlugin from "@grafana/faro-webpack-plugin";

module.exports = {
  // other configs
  plugins: [
    // other plugins
    new FaroSourceMapUploaderPlugin({
      appName: "$your-app-name",
      endpoint: "$your-faro-collector-url",
      apiKey: "$your-api-key",
      appId: "$your-app-id",
      orgId: "$your-org-id",
      gzipContents: true,
    }),
  ],
};
```

### Rollup/Vite

To use the Rollup/Vite plugin, add the following to your `rollup.config.js` or `vite.config.js`:

```javascript
// other imports
import faroUploader from '@grafana/faro-bundler-plugin-rollup';

export default defineConfig(({ mode }) => {
  return {
    // other configs
    plugins: [
      // other plugins
      faroUploader({
        appName: "$your-app-name",
        endpoint: "$your-faro-collector-url",
        apiKey: "$your-api-key",
        appId: "$your-app-id",
        orgId: "$your-org-id",
        gzipContents: true,
      }),
    ],
  };
```

### Configuration Options

The following options are available for the Faro JavaScript bundler plugins:

- `appName: string` *required*: The name of your application. This should match the `appName` value you are using in your Faro Web SDK configuration.
- `endpoint: string` *required*: The URL of your Faro Collector endpoint. This value is in the Frontend Observability plugin under "Settings" -> "Web SDK Config".
- `apiKey: string` *required*: The API key for your Faro Collector. This value gets generated on grafana.com by creating a new scope (details provided in the plugin and in the "Obtaining API key" section of this document).
- `appId: string` *required*: The ID of your application. This should match the `appId` value you are using in your Faro Web SDK configuration.
- `orgId: string` *required*: The ID of your organization. This value is in the Frontend Observability plugin under "Settings" -> "Web SDK Config".
- `outputFiles: string[]` *optional*: An array of source map files to upload. By default, all source maps get uploaded.
- `bundleId: string` *optional*: The ID of the bundle/build. You can specify this value to filter by bundle ID in the Frontend Observability plugin. Otherwise the bundler uses an auto-generated ID.
- `keepSourcemaps: boolean` *optional*: Whether to keep the source maps in your generated bundle after uploading. Defaults to `false`.
- `gzipContents: boolean` *optional*: Whether to tarball and Gzip the contents of the source maps before uploading. Defaults to `true`.
- `verbose: boolean` *optional*: Whether to log verbose output during the upload process. Defaults to `false`.

After initial configuration, the Faro JavaScript bundler plugins automatically uploads your source maps to Grafana Cloud when you build your application. You can verify that the source maps upload successfully by in the "Settings" -> "Source Maps" tab in the Frontend Observability plugin. From there you are able to see the source maps that you have uploaded.

After you have completed all the required steps, you have finished - the Faro Collector begins processing your source maps and associating them with your telemetry data. The portions of your stack traces with source maps uploaded to the Faro Collector are automatically de-obfuscated and displayed in the Frontend Observability plugin when viewing your error data.
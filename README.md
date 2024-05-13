# Faro JavaScript Bundler Plugins

A collection of plugins for various JavaScript bundlers. Used in conjunction with the [Faro Web SDK](https://github.com/grafana/faro-web-sdk) to unlock additional features in [Grafana Cloud Frontend Observability](https://grafana.com/docs/grafana-cloud/monitor-applications/frontend-observability/).

## Getting started

The Faro JavaScript Bundler Plugins are designed to be used with the [Faro Web SDK](https://github.com/grafana/faro-web-sdk) and [Grafana Cloud Frontend Observability](https://grafana.com/products/cloud/frontend-observability-for-real-user-monitoring/). To use these bundler plugins, you must first have instrumented your JavaScript application with Faro and be sending your telemetry data to a Faro Collector endpoint in Grafana Cloud. Follow the Frontend Observability [quickstart guide](https://grafana.com/docs/grafana-cloud/monitor-applications/frontend-observability/quickstart/javascript/) to get started.

Once you have an insrumented JavaScript application sending data to Grafana Cloud, you are ready to get started.

## Installation

To install the Faro JavaScript Bundler Plugins, use the package manager of your choice.

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

## Obtaining API Key

!! TODO - Add instructions on how to obtain API key !!

## Usage

Details of how to use the plugins with your bundler are provided in the Frontend Observability plugin under the "Web SDK Configuration" tab after clicking into your instrumented app.

That tab includes the necessary configuration for the Faro JavaScript Bundler Plugins, including the `appName`, `appId`, and `endpoint` values that are required for the plugins to work with your app. The details provided below are general instructions for how to use the plugins with your bundler.

### Webpack

To use the Webpack plugin, add the following to your `webpack.config.js`:

```javascript
// other imports
import FaroSourcemapUploaderPlugin from "@grafana/faro-webpack-plugin";

module.exports = {
  // other configs
  plugins: [
    // other plugins
    new FaroSourcemapUploaderPlugin({
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

The following options are available for the Faro JavaScript Bundler Plugins:

- `appName: string` (required): The name of your application. This should match the `appName` value you are using in your Faro Web SDK configuration.
- `endpoint: string` (required): The URL of your Faro Collector endpoint. This value is generated in the Frontend Observability plugin under "Web SDK Configuration".
- `apiKey: string` (required): The API key for your Faro Collector. This value is generated on grafana.com by creating a new scope (details provided in the plugin and in the "Obtaining API Key" section of this document).
- `appId: string` (required): The ID of your application. This should match the `appId` value you are using in your Faro Web SDK configuration.
- `orgId: string` (required): The ID of your organization. This value is provided in the Frontend Observability plugin under "Web SDK Configuration".
- `outputFiles: string[]` (optional): An array of sourcemap files to upload. By default, all sourcemaps are uploaded.
- `bundleId: string` (optional): The ID of the bundle/build. You can specify this value to filter by bundle ID in the Frontend Observability plugin. Otherwise an auto-generated ID will be used.
- `keepSourcemaps: boolean` (optional): Whether to keep the sourcemaps in your generated bundle after uploading. Defaults to `false`.
- `gzipContents: boolean` (optional): Whether to tarball and gzip the contents of the sourcemaps before uploading. Defaults to `true`.
- `verbose: boolean` (optional): Whether to log verbose output during the upload process. Defaults to `false`.

After initial configuration, the Faro JavaScript Bundler Plugins will automatically upload your source maps to Grafana Cloud when you build your application. You can verify that the source maps are being uploaded by "Sourcemaps" tab in the Frontend Observability plugin. From there you are able to see the source maps that have been uploaded.

Once you have completed all the required steps, you are done - the Faro Collector will begin processing your source maps and associating them with your telemetry data. The portions of your stacktraces with source maps that have been uploaded to the Faro Collector will be automatically deobfuscated and displayed in the Frontend Observability plugin when viewing your error data.
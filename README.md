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
      }),
    ],
  };
```

After initial configuration, the Faro JavaScript Bundler Plugins will automatically upload your source maps to Grafana Cloud when you build your application. You can verify that the source maps are being uploaded by "Sourcemaps" tab in the Frontend Observability plugin. From there you are able to see the source maps that have been uploaded.

Once you have completed all the required steps, you are done - the Faro Collector will begin processing your source maps and associating them with your telemetry data. The portions of your stacktraces with source maps that have been uploaded to the Faro Collector will be automatically deobfuscated and displayed in the Frontend Observability plugin when viewing your error data.
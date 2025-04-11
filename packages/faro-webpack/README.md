# Faro source map upload plugin - Webpack

This plugin uploads source maps to the Faro collector to enable de-obfuscation of stack traces in the Grafana Cloud Frontend Observability UI.

> [!NOTE]
> The Faro JavaScript bundler plugins work with client-side rendered applications. Server-side rendering isn't yet supported.

## Installation

To install the Faro JavaScript bundler plugins for Webpack, use the package manager of your choice.

```bash
npm install --save-dev @grafana/faro-webpack-plugin
```

To install the Webpack plugin with `yarn`, run:

```bash
yarn add --dev @grafana/faro-webpack-plugin
```

## Usage

Details of how to use the plugins with your bundler reside in the Frontend Observability plugin under the "Settings" -> "Source Maps" tab after clicking into your instrumented app.

That tab includes the necessary configuration for the Faro JavaScript bundler plugins, including the `appName`, `appId`, and `endpoint` values that you need for the plugins to work with your app. The details provided below are general instructions for how to use the plugins with your bundler.

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
      stackId: "$your-stack-id",
      gzipContents: true,
    }),
  ],
};
```

### Configuration Options

The following options are available for the Faro JavaScript bundler plugins:

- `appName: string` *required*: The name of your application, it should match the `appName` value used in your Faro Web SDK configuration
- `endpoint: string` *required*: The URL of your Faro Collector endpoint, found in Frontend Observability under **Settings** and **Web SDK Config**
- `apiKey: string` *required*: The API key for your Faro Collector, you can generate a new scope on [grafana.com], refer to the [Obtaining API key](#obtaining-api-key) section
- `appId: string` *required*: The ID of your application, it should match the `appId` value used in your Faro Web SDK configuration
- `stackId: string` *required*: The ID of the stack, found in Frontend Observability under **Settings** -> **Source Maps** -> **Configure source map uploads**
- `outputFiles: string[]` *optional*: An array of source map files to upload, by default Faro uploads all source maps
- `bundleId: string` *optional*: The ID of the bundle/build, by default auto-generated, or specify an ID to filter by bundle ID in Frontend Observability
- `keepSourcemaps: boolean` *optional*: Whether to keep the source maps in your generated bundle after uploading, default `false`
- `gzipContents: boolean` *optional*: Whether to archive and compress the source maps before uploading, default `true`
- `verbose: boolean` *optional*: Whether to log verbose output during the upload process, default `false`
- `maxUploadSize: number` *optional*: Maximum upload size in bytes, default is 30MB. The Faro API has a 30MB limit for individual file uploads by default. In special circumstances, this limit may be changed by contacting Grafana Cloud support.

After initial configuration, the Faro JavaScript bundler plugins automatically uploads your source maps to Grafana Cloud when you build your application. You can verify that the source maps upload successfully by in the "Settings" -> "Source Maps" tab in the Frontend Observability plugin. From there you are able to see the source maps that you have uploaded.

After you have completed all the required steps, you have finished - the Faro Collector begins processing your source maps and associating them with your telemetry data. The portions of your stack traces with source maps uploaded to the Faro Collector are automatically de-obfuscated and displayed in the Frontend Observability plugin when viewing your error data.
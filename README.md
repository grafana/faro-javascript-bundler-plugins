# Faro JavaScript bundler plugins

A collection of plugins for various JavaScript bundlers. Used in conjunction with the [Faro Web SDK](https://github.com/grafana/faro-web-sdk) to unlock additional features in [Grafana Cloud Frontend Observability](https://grafana.com/docs/grafana-cloud/monitor-applications/frontend-observability/).

## Get started

The Faro JavaScript bundler plugins work with the [Faro Web SDK](https://github.com/grafana/faro-web-sdk) and [Grafana Cloud Frontend Observability](https://grafana.com/products/cloud/frontend-observability-for-real-user-monitoring/). To use these bundler plugins, you must first have instrumented your JavaScript application with Faro and be sending your telemetry data to a Faro Collector endpoint in Grafana Cloud. Follow the Frontend Observability [quickstart guide](https://grafana.com/docs/grafana-cloud/monitor-applications/frontend-observability/quickstart/javascript/) to get started.

After you have an instrumented JavaScript application sending data to Grafana Cloud, you are ready to get started.

> [!NOTE]
> The Faro JavaScript bundler plugins work with client-side rendered applications. Server-side rendering isn't yet supported.

## Installation

To install the Faro JavaScript bundler plugins, use the package manager of your choice.

### Webpack

To install the Webpack plugin with `npm`, run:

```bash
npm install --save-dev @grafana/faro-webpack-plugin
```

To install the Webpack plugin with `yarn`, run:

```bash
yarn add --dev @grafana/faro-webpack-plugin
```

### Rollup/Vite

Rollup and Vite are both supported by the same plugin.

To install the Rollup/Vite plugin with `npm`, run:

```bash
npm install --save-dev @grafana/faro-rollup-plugin
```

To install the Rollup/Vite plugin with `yarn`, run:

```bash
yarn add --dev @grafana/faro-rollup-plugin
```

## Obtaining API key

In order to use the Faro JavaScript bundler plugins, you need to generate an API key with the necessary permissions to upload source maps to Grafana Cloud. To generate an API key, follow these steps:

1. Navigate to the [Grafana website](https://grafana.com/).
1. Sign in to your account and then click the **My Account** button in the top right corner.
1. In the sidebar under **Security**, click **Access Policies** and then click the **Create access policy** button.
1. After creating your access policy, click the **Add token** button in the card for your newly created policy.
1. Select the `sourcemaps:read`, `sourcemaps:delete`, and `sourcemaps:write` scopes from the drop-down list.
1. **Create** the token and be sure to copy the token value, as you aren't be able to see it again.

After you have generated an API key, you can use it in the Faro JavaScript bundler plugins to upload your source maps to Grafana Cloud. Use the generated API key as the `apiKey` value in the configuration options for the bundler plugins.

For best practices, store your API key in a secure location and don't expose it in your source code. Consider using environment variables or a secrets manager to securely store and access your API key.

## Usage

Details of how to use the plugins with your bundler reside in the Frontend Observability plugin under the "Settings" -> "Source Maps" tab after clicking into your instrumented app.

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
      // this URL is different from the Faro Collector URL - find this value in the Frontend Observability plugin under "Settings" -> "Source Maps" tab
      endpoint: "$your-faro-sourcemap-api-url",
      apiKey: "$your-api-key",
      appId: "$your-app-id",
      stackId: "$your-stack-id",
      gzipContents: true,
    }),
  ],
};
```

### Rollup/Vite

To use the Rollup/Vite plugin, add the following to your `rollup.config.js` or `vite.config.js`:

```javascript
// other imports
import faroUploader from '@grafana/faro-rollup-plugin';

export default defineConfig(({ mode }) => {
  return {
    // other configs
    plugins: [
      // other plugins
      faroUploader({
        appName: "$your-app-name",
        // this URL is different from the Faro Collector URL - find this value in the Frontend Observability plugin under "Settings" -> "Source Maps" tab
        endpoint: "$your-faro-sourcemap-api-url",
        apiKey: "$your-api-key",
        appId: "$your-app-id",
        stackId: "$your-stack-id",
        gzipContents: true,
      }),
    ],
  };
});
```

### Configuration Options

The following options are available for the Faro JavaScript bundler plugins:

- `appName: string` *required*: The name of your application, it should match the `appName` value used in your Faro Web SDK configuration
- `endpoint: string` *required*: The URL of your Faro Collector endpoint, found in Frontend Observability under **Settings** -> **Source Maps** -> **Configure source map uploads**
- `apiKey: string` *required*: The API key for your Faro Collector, you can generate a new scope on [grafana.com], refer to the [Obtaining API key](#obtaining-api-key) section
- `appId: string` *required*: The ID of your application, it should match the `appId` value used in your Faro Web SDK configuration
- `stackId: string` *required*: The ID of the stack, found in Frontend Observability under **Settings** -> **Source Maps** -> **Configure source map uploads**
- `outputPath: string` *optional*: Override the output directory path where source maps are located, by default uses the bundler's output.path
- `outputFiles: string[] | RegExp` *optional*: An array of source map files to upload or a regex pattern to match files, by default Faro uploads all source maps
- `bundleId: string` *optional*: The ID of the bundle/build, by default auto-generated, or specify an ID to filter by bundle ID in Frontend Observability
- `keepSourcemaps: boolean` *optional*: Whether to keep the source maps in your generated bundle after uploading, default `false`
- `gzipContents: boolean` *optional*: Whether to archive and compress the source maps before uploading, default `true`
- `verbose: boolean` *optional*: Whether to log verbose output during the upload process, default `false`
- `skipUpload: boolean` *optional*: Whether to skip uploading source maps and only export the bundleId to an environment file, default `false`
- `maxUploadSize: number` *optional*: Maximum upload size in bytes, default is 30MB. The Faro API has a 30MB limit for individual file uploads by default. In special circumstances, this limit may be changed by contacting Grafana Cloud support.
- `recursive: boolean` *optional*: Whether to recursively search subdirectories for source maps, default `false`
- `nextjs: boolean` *optional*: Whether to prepend `_next/` to source map file properties for Next.js compatibility. This should only be needed if your NextJS application has both client and server side code. If your application is only client side, this should not be needed. Default `false` (Webpack only)

After initial configuration, the Faro JavaScript bundler plugins automatically uploads your source maps to Grafana Cloud when you build your application. You can verify that the source maps upload successfully by in the "Settings" -> "Source Maps" tab in the Frontend Observability plugin. From there you are able to see the source maps that you have uploaded.

After you have completed all the required steps, you have finished - the Faro Collector begins processing your source maps and associating them with your telemetry data. The portions of your stack traces with source maps uploaded to the Faro Collector are automatically de-obfuscated and displayed in the Frontend Observability plugin when viewing your error data.

## CLI for Sourcemap Uploads

In addition to the bundler plugins, this repository also provides a CLI tool for uploading source maps to the Faro source map API. This is useful if you want to separate the build process from the source map upload process, or if you want to upload source maps from a CI/CD pipeline.

The CLI uses cURL under the hood to make HTTP requests, which means cURL must be installed on your system. It also provides options for gzipping the payload to reduce upload sizes, which is especially useful for large source map files.

### Installation

To install the CLI with `npm`, run:

```bash
npm install --save-dev @grafana/faro-cli
```

To install the CLI with `yarn`, run:

```bash
yarn add --dev @grafana/faro-cli
```

### Basic Usage

When using with the Faro bundler plugins, you can set the `skipUpload` option to `true` in the plugin configuration to skip uploading source maps during the build process and instead use the CLI to upload them later.

```bash
npx faro-cli upload \
  --endpoint "https://faro-collector-prod-us-east-0.grafana.net" \
  --app-id "your-app-id" \
  --api-key "your-api-key" \
  --stack-id "your-stack-id" \
  --bundle-id "your-bundle-id" \
  --output-path "./dist" \
  --verbose
```

#### File Size Limits

The Faro API has a 30MB limit for individual file uploads by default. This limit applies to the uncompressed size of the files, regardless of whether compression is used during transmission. The CLI automatically handles this by:

1. Checking file sizes before uploading
2. Warning about files that exceed the limit
3. Skipping files that are too large
4. Processing files in a streaming fashion, accumulating files until reaching the size limit before uploading each batch

This streaming approach is the same method used by the bundler plugins, ensuring consistent behavior across all upload methods. The CLI intelligently processes files one by one, uploading batches as they reach the size limit, which optimizes the upload process while staying within the API's size limits.

While the `--gzip-payload` option can significantly reduce the network transfer size, the original uncompressed file size must still be under the configured size limit to be accepted by the API.

You can customize the maximum upload size using the `--max-upload-size` option, which allows you to specify a different size limit in bytes. However, you must file a support ticket with Grafana Cloud to increase the limit on the backend.

#### Gzipping Options

The CLI provides two different gzipping options to optimize uploads:

1. **Gzip Contents (`-g, --gzip-contents`)**: Compresses multiple source map files into a tarball before uploading. Files are processed in a streaming fashion, accumulating until reaching the 30MB limit before creating and uploading each tarball. This is useful when uploading multiple files at once.

2. **Gzip Payload (`-z, --gzip-payload`)**: Compresses the HTTP payload itself using gzip content encoding. This can significantly reduce upload size and is especially useful for large source map files.

Example with gzip payload:

```bash
npx faro-cli upload \
  --endpoint "https://faro-collector-prod-us-east-0.grafana.net" \
  --app-id "your-app-id" \
  --api-key "your-api-key" \
  --stack-id "your-stack-id" \
  --bundle-id "your-bundle-id" \
  --output-path "./dist" \
  --patterns "*.map" \
  --gzip-payload \
  --verbose
```

You can use both options together for maximum compression:

```bash
npx faro-cli upload \
  --endpoint "$your-faro-collector-url" \
  --app-id "$your-app-id" \
  --api-key "$your-api-key" \
  --stack-id "$your-stack-id" \
  --bundle-id env \
  --app-name "$your-app-name" \
  --output-path "./dist" \
  --patterns "*.map" \
  --gzip-contents \
  --gzip-payload \
  --verbose
```

### Injecting Bundle ID into JavaScript Files

For applications that don't use Webpack or Rollup, or in cases where you need to add the bundle ID to already built JavaScript files, you can use the `inject-bundle-id` command:

```bash
npx faro-cli inject-bundle-id \
  --bundle-id "your-bundle-id" \
  --app-name "your-app-name" \
  --files "dist/**/*.js" \
  --verbose
```

This command will:
1. Locate all JavaScript files matching the specified glob patterns
2. Check if each file already has a bundle ID snippet
3. Prepend the bundle ID snippet to files that don't have it
4. Export the bundle ID to an environment variable for potential later use with other commands

#### Options

- `--bundle-id, -b`: The bundle ID to inject (leave blank to generate a random ID)
- `--app-name, -n`: Application name used in the bundle ID snippet
- `--files, -f`: File patterns to match (multiple patterns can be specified)
- `--verbose, -v`: Enable verbose logging
- `--dry-run, -d`: Only print which files would be modified without making changes

#### Examples

Generate a random bundle ID and inject it into all JS files:

```bash
npx faro-cli inject-bundle-id \
  --app-name "my-app" \
  --files "dist/**/*.js" \
  --verbose
```

Do a dry run first to see which files would be modified:

```bash
npx faro-cli inject-bundle-id \
  --bundle-id "your-bundle-id" \
  --app-name "my-app" \
  --files "dist/**/*.js" \
  --dry-run \
  --verbose
```

### Generating a curl Command

If you prefer to use curl directly, you can generate a curl command:

```bash
npx faro-cli curl \
  --endpoint "https://faro-collector-prod-us-east-0.grafana.net" \
  --app-id "your-app-id" \
  --api-key "your-api-key" \
  --stack-id "your-stack-id" \
  --bundle-id "your-bundle-id" \
  --file "./dist/main.js.map"
```

You can also generate a curl command that uses gzip compression:

```bash
npx faro-cli curl \
  --endpoint "https://faro-collector-prod-us-east-0.grafana.net" \
  --app-id "your-app-id" \
  --api-key "your-api-key" \
  --stack-id "your-stack-id" \
  --bundle-id "your-bundle-id" \
  --file "./dist/main.js.map" \
  --gzip-payload
```

This will output a curl command that you can copy and run manually.

For more information about the CLI, see the [CLI README](packages/faro-cli/README.md).
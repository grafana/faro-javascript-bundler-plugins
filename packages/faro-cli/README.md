# Faro CLI

A command-line interface for uploading source maps to the Faro source map API using cURL.

## Installation

```bash
npm install --save-dev @grafana/faro-cli
```

or

```bash
yarn add --dev @grafana/faro-cli
```

## Requirements

- cURL must be installed on your system and available in your PATH.

## Usage

### Uploading Source Maps

The CLI uses cURL under the hood to upload source maps to the Faro API:

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

The CLI will automatically find and upload all `.map` files in the specified output directory and its subdirectories. It recursively searches through all folders to find any source map files, so you don't need to specify patterns or worry about nested directory structures.

#### File Size Limits

The Faro API has a 30MB limit for individual file uploads by default. This limit applies to the uncompressed size of the files, regardless of whether compression is used during transmission. The CLI automatically handles this by:

1. Checking file sizes before uploading
2. Warning about files that exceed the limit
3. Skipping files that are too large
4. Processing files in a streaming fashion, accumulating files until reaching the size limit before uploading each batch

This streaming approach is the same method used by the bundler plugins, ensuring consistent behavior across all upload methods. The CLI intelligently processes files one by one, uploading batches as they reach the size limit, which optimizes the upload process while staying within the API's size limits.

While the `--gzip-payload` option can significantly reduce the network transfer size, the original uncompressed file size must still be under the configured size limit to be accepted by the API.

You can customize the maximum upload size using the `--max-upload-size` option, which allows you to specify a different size limit in bytes.

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
  --endpoint "https://faro-collector-prod-us-east-0.grafana.net" \
  --app-id "your-app-id" \
  --api-key "your-api-key" \
  --stack-id "your-stack-id" \
  --bundle-id "your-bundle-id" \
  --output-path "./dist" \
  --patterns "*.map" \
  --gzip-contents \
  --gzip-payload \
  --verbose
```

### Using with Bundler Plugins

When using with the Faro bundler plugins, you can set the `skipUpload` option to `true` in the plugin configuration to skip uploading source maps during the build process and instead use the CLI to upload them later.

#### Rollup Example

```js
// rollup.config.js
import faroUploader from '@grafana/faro-rollup-plugin';

export default {
  // ... other rollup config
  plugins: [
    // ... other plugins
    faroUploader({
      endpoint: 'https://faro-collector-prod-us-east-0.grafana.net',
      appName: 'my-app',
      appId: 'your-app-id',
      apiKey: 'your-api-key',
      stackId: 'your-stack-id',
      skipUpload: true, // Skip uploading during build
      verbose: true,
    }),
  ],
};
```

Then, after the build, you can upload the source maps using the CLI:

```bash
npx faro-cli upload \
  --endpoint "https://faro-collector-prod-us-east-0.grafana.net" \
  --app-id "your-app-id" \
  --api-key "your-api-key" \
  --stack-id "your-stack-id" \
  --bundle-id env \
  --app-name "my-app" \
  --output-path "./dist" \
  --verbose
```

Note the use of `--bundle-id env` and `--app-name "my-app"` to read the bundle ID from the environment variable set by the bundler plugin.

#### Webpack Example

```js
// webpack.config.js
const FaroSourceMapUploaderPlugin = require('@grafana/faro-webpack-plugin');

module.exports = {
  // ... other webpack config
  plugins: [
    // ... other plugins
    new FaroSourceMapUploaderPlugin({
      endpoint: 'https://faro-collector-prod-us-east-0.grafana.net',
      appName: 'my-app',
      appId: 'your-app-id',
      apiKey: 'your-api-key',
      stackId: 'your-stack-id',
      skipUpload: true, // Skip uploading during build
      verbose: true,
    }),
  ],
};
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

## Options

### Upload Command

- `-e, --endpoint <url>`: Faro API endpoint URL (required)
- `-a, --app-id <id>`: Faro application ID (required)
- `-k, --api-key <key>`: Faro API key (required)
- `-s, --stack-id <id>`: Faro stack ID (required)
- `-b, --bundle-id <id>`: Bundle ID (required, can be set to "env" to read from environment variable)
- `-o, --output-path <path>`: Path to the directory containing source maps (required)
- `-n, --app-name <n>`: Application name (used to find bundleId in environment variables)
- `-k, --keep-sourcemaps`: Keep source maps after uploading (default: false)
- `-g, --gzip-contents`: Compress source maps as a tarball before uploading; files are processed in a streaming fashion, accumulating until the size limit (default: false)
- `-z, --gzip-payload`: Gzip the HTTP payload for smaller uploads (default: false)
- `-v, --verbose`: Enable verbose logging (default: false)
- `-x, --max-upload-size <size>`: Maximum upload size in bytes (default: 30MB or 31457280 bytes)

### Curl Command

- `-e, --endpoint <url>`: Faro API endpoint URL (required)
- `-a, --app-id <id>`: Faro application ID (required)
- `-k, --api-key <key>`: Faro API key (required)
- `-s, --stack-id <id>`: Faro stack ID (required)
- `-b, --bundle-id <id>`: Bundle ID (required, can be set to "env" to read from environment variable)
- `-f, --file <path>`: Path to the source map file (required)
- `-n, --app-name <name>`: Application name (used to find bundleId in environment variables)
- `-t, --content-type <type>`: Content type for the upload (default: "application/json")
- `-z, --gzip-payload`: Generate a command that gzips the payload (default: false)

## License

Apache-2.0
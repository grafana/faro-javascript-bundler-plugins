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

The CLI uses cURL under the hood to upload source maps to the Faro API.

**Web (Webpack / Vite / Rollup / Rspack):**

```bash
npx faro-cli upload \
  --endpoint "your-faro-sourcemap-api-url" \
  --app-id "your-app-id" \
  --api-key "your-api-key" \
  --stack-id "your-stack-id" \
  --bundle-id "your-bundle-id" \
  --output-path "./dist" \
  --verbose
```

**React Native (Metro):**

```bash
npx faro-cli metro upload \
  --map "path/to/your.map" \
  --endpoint "$FARO_SOURCEMAP_ENDPOINT" \
  --app-id   "$FARO_SOURCEMAP_APP_ID" \
  --stack-id "$FARO_SOURCEMAP_STACK_ID" \
  --api-key  "$FARO_SOURCEMAP_API_KEY" \
  --bundle-id "$FARO_BUNDLE_ID" \
  --verbose
```

The two commands differ only in **how they discover the map(s) to upload**:

- `upload` (web) takes a directory via `--output-path` and recursively scans it for every `.map` file. You don't enumerate paths or worry about nested folders.
- `metro upload` (React Native) takes one `.map` path via `--map`. The CLI never derives this path itself — the caller (Gradle hook, Xcode post-build script, manual invocation) is responsible for pointing at the right file. `--bundle-id` (or `FARO_BUNDLE_ID`) must match whatever id `@grafana/faro-metro-plugin` baked into the shipped JS bundle so the uploaded map keys onto Faro's runtime telemetry. See the [`@grafana/faro-metro-plugin` README](../faro-metro-plugin/README.md) for which map to pass on which platform.

Both commands do the same lightweight pre-flight on each `.map` before uploading: parse it as JSON, verify it is a v3 source map, and (for compatibility with downstream symbolication) write back the `file` property if it is missing. They never touch the `mappings`, `sources`, or `sourcesContent` fields. See [Connection settings precedence](#connection-settings-precedence) and [Validation and exit codes](#validation-and-exit-codes) for the full contract.

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
  --endpoint "your-faro-sourcemap-api-url" \
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
  --endpoint "your-faro-sourcemap-api-url" \
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

For `metro upload`, gzipping is **on by default** (the `.map` is POSTed as a gzipped tarball). Pass `--no-gzip` to POST the raw `.map` JSON instead — useful when debugging an upload against a proxy that mangles `Content-Encoding`.

#### Using a Proxy

If you need to route requests through a proxy server, you can use the `--proxy` option:

```bash
npx faro-cli upload \
  --endpoint "your-faro-sourcemap-api-url" \
  --app-id "your-app-id" \
  --api-key "your-api-key" \
  --stack-id "your-stack-id" \
  --bundle-id "your-bundle-id" \
  --output-path "./dist" \
  --proxy "your-proxy:port" \
  --proxy-user "user:pass" \
  --verbose
```

The proxy URL will be passed to cURL using the `--proxy` parameter. If your proxy requires authentication, you can use the `--proxy-user` option (or `-U`) to provide credentials in the format `username:password`. The same `--proxy` and `--proxy-user` flags work identically on `metro upload`.

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

> **Web only.** This command is for already-built JavaScript bundles produced by web bundlers that don't already integrate the Faro plugin. The React Native (Metro) flow injects the bundle id at Metro time via `@grafana/faro-metro-plugin`'s preamble, so you don't run `inject-bundle-id` on RN bundles.

### Injecting Git Hash into JavaScript Files

For applications that build without access to a `.git` directory, or in post-build pipelines where you want to stamp already-built JavaScript files with the commit hash, use the `inject-git-hash` command:

```bash
npx faro-cli inject-git-hash \
  --app-name "your-app-name" \
  --files "dist/**/*.js" \
  --verbose
```

When `--git-hash` is not provided, the command auto-detects the hash via `git rev-parse HEAD`. If the hash cannot be resolved, the command exits with a non-zero error code.

**Explicit hash for CI:**

```bash
npx faro-cli inject-git-hash \
  --git-hash "$GITHUB_SHA" \
  --app-name "your-app-name" \
  --files "dist/**/*.js"
```

#### Options

- `--git-hash, -g`: Git commit hash to inject. Auto-detected via `git rev-parse HEAD` if not provided; exits with error if unresolvable.
- `--app-name, -n`: Application name used in the git hash snippet (required)
- `--files, -f`: File patterns to match (glob patterns supported)
- `--verbose, -v`: Enable verbose logging
- `--dry-run, -d`: Print which files would be modified without making changes

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
      // this URL is different from the Faro Collector URL - find this value in the Frontend Observability plugin under "Settings" -> "Source Maps" -> "Configure source map uploads"
      endpoint: 'https://faro-api-prod-us-east-0.grafana.net/faro/api/v1',
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
  --endpoint "your-faro-sourcemap-api-url" \
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
      endpoint: 'https://faro-api-prod-us-east-0.grafana.net/faro/api/v1',
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

#### Metro Example (React Native)

`@grafana/faro-metro-plugin` is the equivalent of the Webpack/Rollup plugins for React Native. It supports the same `skipUpload` option, with the same meaning: when `true`, the plugin won't upload it.

```js
// metro.config.js
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const withFaroConfig = require('@grafana/faro-metro-plugin').default;

const faroOpts = {
  appName: 'MyApp',
  endpoint: 'https://faro-api-prod-us-east-0.grafana.net/faro/api/v1',
  appId: 'your-app-id',
  stackId: 'your-stack-id',
  apiKey: process.env.FARO_SOURCEMAP_API_KEY,
  bundleId: process.env.FARO_BUNDLE_ID,
  verbose: true,
};

module.exports = mergeConfig(
  getDefaultConfig(__dirname),
  withFaroConfig({}, faroOpts),
);
```

Manual invocation has the same shape on every platform:

```bash
npx faro-cli metro upload \
  --map "path/to/your.map" \
  --endpoint "$FARO_SOURCEMAP_ENDPOINT" \
  --app-id   "$FARO_SOURCEMAP_APP_ID" \
  --stack-id "$FARO_SOURCEMAP_STACK_ID" \
  --api-key  "$FARO_SOURCEMAP_API_KEY" \
  --bundle-id "$FARO_BUNDLE_ID"
```

Each connection setting (and `--bundle-id`) also accepts the matching `FARO_*` env var as a fallback if the flag is omitted, so a step that already exports the full `FARO_*` set can call `faro-cli metro upload --map …` and nothing else.

### Generating a curl Command

If you prefer to use curl directly, you can generate a curl command. Web example:

```bash
npx faro-cli curl \
  --endpoint "your-faro-sourcemap-api-url" \
  --app-id "your-app-id" \
  --api-key "your-api-key" \
  --stack-id "your-stack-id" \
  --bundle-id "your-bundle-id" \
  --file "./dist/main.js.map"
```

React Native (Metro) — same `curl` subcommand, just point `--file` at the `.map` you want to upload and pass the bundle id that matches your shipped JS:

```bash
npx faro-cli curl \
  --endpoint "$FARO_SOURCEMAP_ENDPOINT" \
  --app-id   "$FARO_SOURCEMAP_APP_ID" \
  --api-key  "$FARO_SOURCEMAP_API_KEY" \
  --stack-id "$FARO_SOURCEMAP_STACK_ID" \
  --bundle-id "$FARO_BUNDLE_ID" \
  --file     "path/to/your.map"
```

You can also generate a curl command that uses gzip compression:

```bash
npx faro-cli curl \
  --endpoint "your-faro-sourcemap-api-url" \
  --app-id "your-app-id" \
  --api-key "your-api-key" \
  --stack-id "your-stack-id" \
  --bundle-id "your-bundle-id" \
  --file "./dist/main.js.map" \
  --gzip-payload
```

You can also generate a curl command that uses a proxy:

```bash
npx faro-cli curl \
  --endpoint "your-faro-sourcemap-api-url" \
  --app-id "your-app-id" \
  --api-key "your-api-key" \
  --stack-id "your-stack-id" \
  --bundle-id "your-bundle-id" \
  --file "./dist/main.js.map" \
  --proxy "http://proxy.example.com:8080" \
  --proxy-user "username:password"
```

This will output a curl command that you can copy and run manually.

## Options

### Upload Command

- `-e, --endpoint <url>`: Faro API endpoint URL (required) - find this value in the Frontend Observability plugin under **Settings** -> **Source Maps** -> **Configure source map uploads**
- `-a, --app-id <id>`: Faro application ID (required)
- `-k, --api-key <key>`: Faro API key (required)
- `-s, --stack-id <id>`: Faro stack ID (required) - find this value in the Frontend Observability plugin under **Settings** -> **Source Maps** -> **Configure source map uploads**
- `-b, --bundle-id <id>`: Bundle ID (required, can be set to "env" to read from environment variable)
- `-o, --output-path <path>`: Path to the directory containing source maps (required)
- `-n, --app-name <name>`: Application name (used to find bundleId in environment variables)
- `-k, --keep-sourcemaps`: Keep source maps after uploading (default: false)
- `-g, --gzip-contents`: Compress source maps as a tarball before uploading; files are processed in a streaming fashion, accumulating until the size limit (default: false)
- `-z, --gzip-payload`: Gzip the HTTP payload for smaller uploads (default: false)
- `-v, --verbose`: Enable verbose logging (default: false)
- `-r, --recursive`: Recursively search subdirectories for source maps (default: false)
- `-i, --max-upload-size <size>`: Maximum upload size in bytes, default is 30MB. The Faro API has a 30MB limit for individual file uploads by default. In special circumstances, this limit may be changed by contacting Grafana Cloud support.
- `-x, --proxy <url>`: Proxy URL to use for cURL requests (optional)
- `-U, --proxy-user <user:password>`: Username and password for proxy authentication (optional)

### inject-git-hash Command

- `-g, --git-hash <hash>`: Git commit hash to inject (auto-detected via `git rev-parse HEAD` if not provided; exits with error if unresolvable)
- `-n, --app-name <name>`: Application name used in the git hash snippet (required)
- `-f, --files <patterns...>`: File patterns to match (glob patterns supported)
- `-v, --verbose`: Enable verbose logging (default: false)
- `-d, --dry-run`: Print which files would be modified without making changes (default: false)

### Curl Command

- `-e, --endpoint <url>`: Faro API endpoint URL (required) - find this value in the Frontend Observability plugin under **Settings** -> **Source Maps** -> **Configure source map uploads**
- `-a, --app-id <id>`: Faro application ID (required)
- `-k, --api-key <key>`: Faro API key (required)
- `-s, --stack-id <id>`: Faro stack ID (required) - find this value in the Frontend Observability plugin under **Settings** -> **Source Maps** -> **Configure source map uploads**
- `-b, --bundle-id <id>`: Bundle ID (required, can be set to "env" to read from environment variable)
- `-f, --file <path>`: Path to the source map file (required)
- `-n, --app-name <name>`: Application name (used to find bundleId in environment variables)
- `-t, --content-type <type>`: Content type for the upload (default: "application/json")
- `-z, --gzip-payload`: Generate a command that gzips the payload (default: false)
- `-x, --proxy <url>`: Proxy URL to use for cURL requests (optional)
- `-U, --proxy-user <user:password>`: Username and password for proxy authentication (optional)

### Metro Upload Command (`metro upload`)

- `--map <path>` (required): Path to the `.map` file to upload. The CLI does
  not derive or autodetect this path — the caller picks the file.
- `-e, --endpoint <url>`: Faro source map API base URL. Falls back to
  `FARO_SOURCEMAP_ENDPOINT`.
- `-a, --app-id <id>`: Faro app id. Falls back to `FARO_SOURCEMAP_APP_ID`.
- `-s, --stack-id <id>`: Grafana Cloud stack id. Falls back to
  `FARO_SOURCEMAP_STACK_ID`.
- `-k, --api-key <key>`: Bearer API key. Falls back to
  `FARO_SOURCEMAP_API_KEY`.
- `-b, --bundle-id <id>`: Bundle id that matches the shipped JS bundle.
  Falls back to `FARO_BUNDLE_ID`.
- `--no-gzip`: POST the raw `.map` JSON instead of a gzipped tarball.
- `-v, --verbose`: Verbose logging.
- `--dry-run`: Show what would be uploaded and exit.
- `-i, --max-upload-size <size>`: Maximum upload size in bytes (default: 30MB).
- `-x, --proxy <url>`, `-U, --proxy-user <user:password>`: Same as the other subcommands.

#### Connection settings precedence

For each connection setting and the bundle id, resolution is "first non-empty wins": **CLI flag > matching env var**.

| Setting          | CLI flag       | Env fallback              |
| ---------------- | -------------- | ------------------------- |
| Endpoint base    | `--endpoint`   | `FARO_SOURCEMAP_ENDPOINT` |
| App id           | `--app-id`     | `FARO_SOURCEMAP_APP_ID`   |
| Stack id         | `--stack-id`   | `FARO_SOURCEMAP_STACK_ID` |
| API key          | `--api-key`    | `FARO_SOURCEMAP_API_KEY`  |
| Bundle id        | `--bundle-id`  | `FARO_BUNDLE_ID`          |

The map path (`--map`) is **required** and has no env fallback or autodetect.

#### Validation and exit codes

The `.map` is parsed and structurally validated before any upload attempt. The CLI never inspects or rewrites `mappings`, `sources`, or `sourcesContent`; if the `file` property is missing, it is set from the map filename so downstream symbolication can key onto it.

| Exit code | Meaning |
| --------- | ------- |
| `0`       | Upload succeeded (or `--dry-run` finished). |
| `1`       | Upload was attempted and the API rejected it (re-run with `--verbose`). |
| `2`       | Pre-flight failed: missing required setting, missing/unparseable map, non-v3 map, or map exceeds the size limit. |
| `3`       | The map parsed as v3 but its `sources` array is empty. Whatever produced the file emitted a structurally valid but useless map; investigate upstream of the CLI. Wire CI alarms onto this code separately. |

## License

Apache-2.0

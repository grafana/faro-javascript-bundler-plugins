# Faro source map upload — Metro (React Native)

This package wraps **Metro** so release bundles get:

1. A **Faro bundle id** preamble at the top of the JS bundle (same mechanism as `@grafana/faro-webpack-plugin`), so `meta.app.bundleId` matches the uploaded source map bundle in `@grafana/faro-web-sdk` / `@grafana/faro-react-native`.
2. A **source map** whose generated lines are shifted to account for that preamble.
3. Optional **upload** of the map to the Grafana Frontend Observability source map API (release builds only, same auth model as other Faro bundler plugins).

> `appName` here must match the **`app.name`** you pass to `initializeFaro` in the React Native SDK.

## Installation

```bash
npm install --save-dev @grafana/faro-metro-plugin
# or
yarn add --dev @grafana/faro-metro-plugin
```

## Usage

In `metro.config.js`:

```javascript
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const withFaroConfig = require('@grafana/faro-metro-plugin').default;

const faroOpts = {
  appName: 'MyApp',
  endpoint: 'https://your-collector.example.com/api/v1',
  appId: 'your-app-id',
  stackId: 'your-stack-id',
  apiKey: process.env.FARO_SOURCEMAP_API_KEY,
  bundleId: process.env.FARO_BUNDLE_ID,
  verbose: true,
};

module.exports = mergeConfig(getDefaultConfig(__dirname), withFaroConfig({}, faroOpts));
```

### Environment variables

| Variable | Purpose |
|----------|---------|
| `FARO_SOURCEMAP_API_KEY` | Bearer API key for uploads (often set in CI). |
| `FARO_BUNDLE_ID` | **Release:** stable id for this build (commit SHA, CI build number, etc.). Omit in dev. |
| `FARO_SKIP_SOURCEMAP_UPLOAD` | Set to `1` or `true` (case-insensitive) to skip upload while keeping the preamble and map fixes. |

Uploads are skipped when `NODE_ENV=development`, when `skipUpload: true`, or when building with Metro `dev: true`, unless you override `skipUpload`.

### Optional: `sourceMapFile`

The plugin writes a temporary `*.map` whose basename (without `.map`) becomes the source map **`file`** field (default **`bundle.js`**). Hermes release stacks often omit a real filename; `@grafana/faro-react-native` defaults `releaseBundleFilename` to **`bundle.js`** so stack frames resolve to the same key the API stores.

If you change this, set the same value in the RN SDK via `releaseBundleFilename`.

### CLI sanity check: `react-native bundle`

Use the same **`appName`** / **`FARO_BUNDLE_ID`** / upload settings as CI. Typical outputs:

**Android**

```bash
npx react-native bundle \
  --platform android \
  --dev false \
  --minify true \
  --entry-file index.js \
  --bundle-output dist/android-release/index.android.bundle \
  --sourcemap-output dist/android-release/index.android.bundle.map \
  --assets-dest dist/android-release/res
```

**iOS** — set **`sourceMapFile`** to **`main.jsbundle`** for this invocation (here via env) so the map’s **`file`** field matches iOS Hermes stacks and **`releaseBundleFilename`**:

```bash
FARO_PLATFORM=ios npx react-native bundle \
  --platform ios \
  --dev false \
  --minify true \
  --entry-file index.js \
  --bundle-output dist/ios-release/main.jsbundle \
  --sourcemap-output dist/ios-release/main.jsbundle.map \
  --assets-dest dist/ios-release/assets
```

**Verify:** preamble at the top of the `.jsbundle` / `.bundle` sets **`__faroBundleId_<appName>`**; the **`.map`** parses as JSON with **`version` 3**, non-empty **`sources`**, and **`file`** equal to the bundle basename you configured (`index.android.bundle` vs `main.jsbundle`).

## Grafana UI

In **Frontend Observability → your app → Settings**, use the **Source Maps** tab for `endpoint`, `appId`, `stackId`, and install snippets (Metro is included for mobile apps).

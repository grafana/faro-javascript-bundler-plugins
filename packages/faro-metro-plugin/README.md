# Faro source maps — Metro (React Native)

This package configures **Metro** so release bundles work end-to-end with Grafana Frontend Observability:

1. **Bundle id preamble** — Same idea as `@grafana/faro-webpack-plugin`: a small snippet at the top of the JS bundle sets `meta.app.bundleId` so it matches the source map record in `@grafana/faro-react-native` / `@grafana/faro-web-sdk`.

2. **Source map shape** — Metro emits the packager map in the form Hermes precompile, Hermes interpreter, or JSC expects (see [Hermes modes](#hermes-modes)).

3. **Upload** — Happens **after** the native pipeline produces the **composed** map (`hermesc` + `compose-source-maps.js`). Metro does **not** upload; the composed map is the one the collector uses for symbolication.

---

## End-to-end flow

| Step | Where |
|------|--------|
| 1 | Install `@grafana/faro-metro-plugin` and wrap `metro.config.js` with `withFaroConfig`. |
| 2 | Install and initialise `@grafana/faro-react-native` with the **same `app.name`** as `appName` in Metro options. |
| 3 | For **release** builds, export `FARO_BUNDLE_ID` and `FARO_SOURCEMAP_*` (see [Environment variables](#environment-variables)). |
| 4 | <ul><li><strong>Android:</strong> Upload runs from Gradle after the composed map is produced (see <a href="#android">Android</a>).</li><li><strong>iOS:</strong> Upload after the composed map exists via Xcode automation that calls this package’s <code>bin/</code> helpers (Release-only), or manually with <code>faro-cli metro upload</code> (see <a href="#ios-upload">iOS upload</a>).</li></ul> |

Symbolication runs **server-side in the Faro collector**: it loads the map by `bundleId` from the source map API and resolves stack frames.

---

## Installation

```bash
npm install --save-dev @grafana/faro-metro-plugin
# or
yarn add --dev @grafana/faro-metro-plugin
```

Also add **`@grafana/faro-react-native`** as a runtime dependency if you use the standard Android Gradle wiring.

---

## Metro configuration

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

**Metro uses:** `appName`, `bundleId` (or `FARO_BUNDLE_ID`), optional `hermes`, `sourceMapFile`, `skipUpload`, `verbose`.  
The shared option shape also requires `endpoint`, `appId`, `stackId`, `apiKey`; keep them aligned with **Frontend Observability → Settings → Source Maps** and with the same values you pass into **`faro-cli metro upload`** or your Gradle / Xcode automation.

When using **`@sentry/react-native`**, wrap **Sentry outside** and **Faro inside** so the preamble stays first, for example:

`mergeConfig(getDefaultConfig(__dirname), withSentryConfig(withFaroConfig({}, faroOpts)))` — check Sentry’s docs for your RN version.

---

## Environment variables

| Variable | Purpose |
|----------|---------|
| `FARO_SOURCEMAP_API_KEY`          | Bearer token for the upload HTTP request (Gradle, Xcode automation, or CLI).                                                                                                                                                                                                       |
| `FARO_SOURCEMAP_ENDPOINT`       | Collector API base URL (Gradle, Xcode automation, or CLI).                                                                                                                                                                                                                           |
| `FARO_SOURCEMAP_APP_ID`         | App id segment in the upload URL (Gradle, Xcode automation, or CLI).                                                                                                                                                                                                                  |
| `FARO_SOURCEMAP_STACK_ID`       | Stack id for the upload (Gradle, Xcode automation, or CLI).                                                                                                                                                                                                                           |
| `FARO_BUNDLE_ID` | **Release:** Stable build id (commit SHA, CI build number, …). Must match what Metro baked into the bundle. Omit for local dev. |
| `FARO_SKIP_SOURCEMAP_UPLOAD` | If `1` or `true`, native upload steps skip while still building; preamble and map shaping unchanged. Also participates in dev bundle-id behaviour when no explicit id is set. |
| `FARO_DISABLE_HERMES_PRECOMPILE` | **Rare.** Only if Metro runs with **`dev: false`** but the JS you ship **never** goes through the usual native **`hermesc` + `compose-source-maps.js`** step (see [When Hermes skips native precompile](#when-hermes-skips-native-precompile)). **Dev** does not need this—Metro `dev: true` is detected automatically. **Normal** Android/iOS **release** builds must **leave this unset**. |

`skipUpload: true`, `NODE_ENV=development`, Metro `dev: true`, and `FARO_SKIP_SOURCEMAP_UPLOAD` affect placeholder bundle ids and whether native upload steps run; none of them perform upload from Metro.

### When Hermes skips native precompile

Set **`FARO_DISABLE_HERMES_PRECOMPILE`** only in the situations below. Everyone else should **omit** it.

**Default:** leave it **unset**. That matches **stock** React Native: e.g. Android `./gradlew assembleRelease` (or your project’s equivalent that runs `bundleReleaseJsAndAssets` and the RN Hermes/map steps) and iOS **Release** archive—those pipelines **always** precompile Hermes bytecode and compose maps after Metro.

Metro already chooses the right map shape for **development** (`dev: true` → Hermes “runtime” / flattened map). You do **not** need this variable for `npx react-native start` or day-to-day debugging.

**Set the variable (usually only in CI or a dedicated script)** when **all** of the following are true:

1. You produce a **production** bundle with Metro **`dev: false`** (same as a release JS bundle).
2. That bundle is loaded in Hermes in a way where stack traces look like **dev Hermes** (`line 1` + UTF-8 **byte column** in the JS source text)—not like a map meant for the **composed** Hermes bytecode pipeline.
3. Your pipeline **does not** run the standard post-Metro **`hermesc` + `compose-source-maps.js`** flow that `assembleRelease` / a typical Xcode Release build performs.

**Concrete-style example (illustrative, not a single official command):** a team runs only `npx react-native bundle --platform android --dev false …` in CI, ships `index.android.bundle` + `.map` through a **custom** native shell or distribution path, and **never** invokes Gradle’s release Hermes steps that merge Metro’s map with the bytecode map. Production crashes then behave like **Hermes-on-raw-bundle** symbolication; setting `FARO_DISABLE_HERMES_PRECOMPILE=1` for **that** Metro job makes the emitted map match those stacks. The same app built with a **normal** `./gradlew assembleRelease` must **not** set this—doing so can break `compose-source-maps` (multi-line packager map is required there).

**Who sets it:** not every developer—only the maintainer of the **non-standard** build defines it once (e.g. export in the CI job or script that runs the odd Metro-only release bundle).

---

## Hermes modes

How Metro output is shaped depends on the scenario. The plugin **always** injects the Faro bundle id line at the top of the JS; it **reshapes** the source map only when the engine reports positions in a different coordinate system.

| Scenario | What the plugin is doing (plain language) | What you end up with |
|----------|---------------------------------------------|----------------------|
| **Release, Hermes (normal RN)** | Tags the bundle with a Faro id; **lightly** fixes the map so that extra line doesn’t break positions; leaves a **normal** multi-line map so the native build can still merge Metro + Hermes maps. | JS **with** id + map ready for the **native** Hermes/compose step; production symbolication usually uses the **final** map from that pipeline. |
| **Dev, Metro + Hermes** | Tags the bundle; **rewrites** the map so Hermes dev errors (one line + byte offset) can still be mapped back to source. | JS **with** id + **flattened** map that matches **live dev** stacks. |
| **JSC only** | Tags the bundle; **only** shifts line numbers for that id line—no Hermes-specific map rewrite. | JS **with** id + **classic** line/column map. |

We always label the bundle; we only “reshape” the source map when the JavaScript engine reports crashes in a different coordinate system (Hermes in dev).

**Implementation (reference):** internal mode names and triggers:

| Mode | When | Map shape from Metro |
|------|------|----------------------|
| `precompiled` | `dev: false`, Hermes enabled (`hermes !== false`), `FARO_DISABLE_HERMES_PRECOMPILE` unset — **typical Android/iOS release** | Multi-line map with `+1` line shift on generated lines |
| `runtime` | `dev: true` **or** `FARO_DISABLE_HERMES_PRECOMPILE` set | Single-line mappings with UTF-8 byte offsets on line 1 |
| `jsc` | `hermes: false` in plugin options | Multi-line map with `+1` line shift |

For **`precompiled`**, Xcode/Gradle run `compose-source-maps.js` after Metro. That step needs the **multi-line** packager map; flattening it at Metro would break the composed map (`sources` empty) and symbolication.

Upload always happens **after** compose: Gradle on Android, Xcode automation calling this package’s **`bin/`** on iOS (Release-only), or **`faro-cli metro upload`** where you drive uploads yourself.

---

## Android

### With `@grafana/faro-react-native`

1. Dependencies: `@grafana/faro-react-native` (app) and `@grafana/faro-metro-plugin` (dev).
2. Configure Metro as in [Metro configuration](#metro-configuration).
3. Export `FARO_BUNDLE_ID` and all `FARO_SOURCEMAP_*` vars before release builds.
4. Run a normal release workflow (`yarn android --mode=release`, `installRelease`, `assembleRelease`, `bundleRelease`, …).

React Native autolinks the SDK’s Android library. Its **`android/build.gradle`** registers **`faroUploadComposedSourceMapAndroidRelease`** on your **`:app`** project and attaches it as a finaliser of **`bundleReleaseJsAndAssets`** / **`createBundleReleaseJsAndAssets`** after `gradle.projectsEvaluated`.

You **do not** edit `android/app/build.gradle` for this path.

The task runs **`node_modules/@grafana/faro-metro-plugin/bin/faro-upload-source-map.js`**, which invokes **`faro-cli metro upload`** with `--map` pointing at:

`android/app/build/generated/sourcemaps/react/release/index.android.bundle.map`

and passes `--bundle-id`, `--endpoint`, `--app-id`, `--stack-id`, `--api-key` from the Gradle environment.

If the shim is missing, the composed map does not exist, any required env var is missing, or `FARO_SKIP_SOURCEMAP_UPLOAD` is set, the task logs and **skips** — it does not fail the build.

### Without `@grafana/faro-react-native`

Use the same Gradle behaviour by applying this package’s script from **`android/app/build.gradle`**:

```groovy
apply from: file("../../node_modules/@grafana/faro-metro-plugin/android/source-map-upload.gradle")
```

Adjust the relative path if your `node_modules` layout differs. Export the same env vars as above before release builds.

---

## iOS upload

**Layout (same idea as Android):** Anything executable lives in **`@grafana/faro-metro-plugin`** under **`bin/`** (for example the existing **`faro-upload-source-map`** entry that forwards to **`faro-cli metro upload`**). **`@grafana/faro-react-native`** should only wire Xcode — for example a React Native **`scriptPhases`** hook — that **`exec`s those paths under `node_modules/@grafana/faro-metro-plugin/bin/`**, not ship duplicate scripts inside the SDK.

**Release-only:** That Xcode step **must** no-op on non-Release configurations (inspect Xcode’s **`CONFIGURATION`** / equivalent). Debug and simulator-oriented builds stay quiet and never call the upload CLI.

**Manual / CI (when nothing uploads the map for you):** Use this if the **automatic** path does not run—for example you have **not** wired the Android Gradle task or an Xcode **Release** script phase that calls **`node_modules/@grafana/faro-metro-plugin/bin/`**, upload steps are skipped (`FARO_SKIP_SOURCEMAP_UPLOAD`, missing env vars), or CI builds the composed map in a job **without** those hooks. Invoke **`faro-cli metro upload`** after Release produces the **composed** map:

```bash
npx faro-cli metro upload \
  --map "$BUILD_DIR/main.jsbundle.map" \
  --endpoint "$FARO_SOURCEMAP_ENDPOINT" \
  --app-id "$FARO_SOURCEMAP_APP_ID" \
  --stack-id "$FARO_SOURCEMAP_STACK_ID" \
  --api-key "$FARO_SOURCEMAP_API_KEY" \
  --bundle-id "$FARO_BUNDLE_ID"
```

**Android** the same way—only when Gradle is **not** already running the upload finaliser (or you need a standalone CI step using the **same** flags as Gradle):

```bash
npx faro-cli metro upload \
  --map android/app/build/generated/sourcemaps/react/release/index.android.bundle.map \
  --endpoint "$FARO_SOURCEMAP_ENDPOINT" \
  --app-id "$FARO_SOURCEMAP_APP_ID" \
  --stack-id "$FARO_SOURCEMAP_STACK_ID" \
  --api-key "$FARO_SOURCEMAP_API_KEY" \
  --bundle-id "$FARO_BUNDLE_ID"
```

Flags accept the matching `FARO_*` env fallbacks where documented in [`@grafana/faro-cli`](../faro-cli/README.md#uploading-react-native-metro--hermes-composed-source-maps).

The CLI rejects composed maps with **empty `sources`** (usually wrong Metro map shape for `compose-source-maps.js`) and exits with code **`3`**.

---

## Optional: `sourceMapFile`

Metro writes the map’s **`file`** field from this basename (default **`bundle.js`**). Align with **`releaseBundleFilename`** in `@grafana/faro-react-native` if you change it.

---

## Sanity check: `react-native bundle`

Match **`appName`**, **`FARO_BUNDLE_ID`**, and upload settings with CI.

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

**iOS** — Set **`sourceMapFile`** to **`main.jsbundle`** for this run so the map’s **`file`** matches stacks and **`releaseBundleFilename`**:

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

**Check:** Bundle starts with **`__faroBundleId_<appName>`**; `.map` is JSON **`version` 3**, non-empty **`sources`**, **`file`** matching your bundle basename.

---

## Grafana UI

In **Frontend Observability → your app → Settings**, open **Source Maps** for `endpoint`, `appId`, `stackId`, and Metro-oriented snippets.

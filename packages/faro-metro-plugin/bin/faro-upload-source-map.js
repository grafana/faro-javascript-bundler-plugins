#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * `faro-upload-source-map` binary for `@grafana/faro-metro-plugin`.
 *
 * Forwards every CLI argument verbatim to `faro-cli metro upload` by
 * spawning Node on `@grafana/faro-cli`'s `cli.js`, then exits with the
 * child process's status code. Intended for callers that resolve binaries
 * by package name, e.g.:
 *
 *   npx --package @grafana/faro-metro-plugin faro-upload-source-map --map …
 *
 * For direct manual invocation, call `npx faro-cli metro upload …`.
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cliPath = fileURLToPath(import.meta.resolve('@grafana/faro-cli/dist/cli.js'));
const result = spawnSync(process.execPath, [cliPath, 'metro', 'upload', ...process.argv.slice(2)], {
  stdio: 'inherit',
});
process.exit(result.status ?? 1);

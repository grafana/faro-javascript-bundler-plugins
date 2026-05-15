# Releasing

Releases are fully automated via [release-please].

1. Land your change on `main` using a Conventional Commit prefix
   (`fix:`, `feat:`, `feat!:` — `refactor:`/`chore:` do **not** trigger releases).
2. release-please will open or update a PR titled `chore: release main`
   with version bumps and CHANGELOG entries for the affected packages.
3. Merging that PR runs `.github/workflows/release-please.yml`, which
   tags the release and publishes the bumped packages to npm.

No manual `lerna version` / `lerna publish` is needed.

[release-please]: https://github.com/googleapis/release-please

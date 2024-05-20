# Releasing

## 0. Create a new branch

Create a new branch for the release using the pattern `vX.Y.Z` where `X.Y.Z` is the new version number.

## 1. Update the version number

Update the version number in the following files:
- `lerna.json`
- `packages/faro-rollup/package.json`
- `packages/faro-webpack/package.json`
- `packages/faro-bundlers-shared/package.json`

## 2. Update the changelog

Update the version number in the following files:
- `packages/faro-rollup/CHANGELOG.md`
- `packages/faro-webpack/CHANGELOG.md`
- `packages/faro-bundlers-shared/CHANGELOG.md`

## 3. Commit, push, and merge changes

Commit the changes and push the branch to the repository.

## 4. Create a new tag

Create a new tag for the release using the pattern `vX.Y.Z` where `X.Y.Z` is the new version number.

A new release will be published and pushed to NPM automatically.
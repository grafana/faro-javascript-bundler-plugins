# Releasing

## 1. Update the changelog

Update the version number in the following files:
- `packages/faro-rollup/CHANGELOG.md`
- `packages/faro-webpack/CHANGELOG.md`
- `packages/faro-bundlers-shared/CHANGELOG.md`

## 2. Use lerna to release

Run the following:

```bash
npx lerna version --force-publish
```

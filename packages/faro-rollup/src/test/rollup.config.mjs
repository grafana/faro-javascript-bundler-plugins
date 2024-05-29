import faroUploader from '@grafana/faro-rollup-plugin';

export const config =
{
  input: "./src/test/main.js",
  output: {
    file: './dist/bundle.js'
  },
  plugins: [
    faroUploader({
      appName: 'rollup-test-app',
      endpoint: 'http://localhost:8000/faro/api/v1',
      appId: '1',
      orgId: '1',
      gzipContents: true,
      bundleId: 'test'
    })
  ]
};

export default config;
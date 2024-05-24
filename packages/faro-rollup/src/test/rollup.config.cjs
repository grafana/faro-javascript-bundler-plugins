const faroUploader = require('@grafana/faro-rollup-plugin');

module.exports =
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
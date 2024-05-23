const faroUploader = require('@grafana/faro-rollup-plugin');

module.exports = (env = {}) => (
  {
    input: "main.js",
    output: {
      filename: 'bundle.js'
    },
    plugins: [
      faroUploader({
        appName: 'rollup-test-app',
        endpoint: 'http://localhost:8000/faro/api/v1',
        appId: '1',
        orgId: '1',
        gzipContents: true,
      })
    ]
  });
const FaroSourcemapUploaderPlugin = require('@grafana/faro-webpack-plugin');

module.exports = () => (
  {
    entry: './main.js',
    output: {
      filename: 'bundle.js'
    },
    mode: 'production',
    plugins: [
      new FaroSourcemapUploaderPlugin({
        appName: 'webpack-test-app',
        endpoint: 'http://localhost:8000/faro/api/v1',
        appId: '1',
        orgId: '1',
        gzipContents: true,
      }),
    ]
  }
)
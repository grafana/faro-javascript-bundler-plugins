import FaroSourcemapUploaderPlugin from '@grafana/faro-webpack-plugin';

const config = {
  entry: {
    module: './main.cjs'
  },
  output: {
    filename: 'bundle.cjs'
  },
  mode: 'production',
  plugins: [
    new FaroSourcemapUploaderPlugin({
      appName: 'webpack-test-app',
      endpoint: 'http://localhost:8000/faro/api/v1',
      appId: '1',
      orgId: '1',
      gzipContents: true,
      bundleId: 'test'
    }),
  ]
};

export default config;
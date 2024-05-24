import FaroSourcemapUploaderPlugin from '@grafana/faro-webpack-plugin';
import path from 'path';

const config = {
  entry: {
    module: './main.cjs'
  },
  output: {
    filename: 'bundle.js',
    path: path.resolve(process.cwd(), 'dist'),
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
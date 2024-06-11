import FaroSourceMapUploaderPlugin from '@grafana/faro-webpack-plugin';
import path from 'path';

export const config = {
  entry: {
    module: './main.cjs'
  },
  output: {
    filename: 'bundle.js',
    path: path.resolve(process.cwd(), 'dist'),
  },
  mode: 'production',
  plugins: [
    new FaroSourceMapUploaderPlugin({
      appName: 'webpack-test-app',
      endpoint: 'http://localhost:8000/faro/api/v1',
      appId: '1',
      gzipContents: true,
      bundleId: 'test'
    }),
  ]
};

export default config;
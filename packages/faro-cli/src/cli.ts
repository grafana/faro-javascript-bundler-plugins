import { Command } from 'commander';
import { uploadSourceMaps, generateCurlCommand } from './index';
import { consoleInfoOrange } from '@grafana/faro-bundlers-shared';
import path from 'path';
import fs from 'fs';

interface UploadOptions {
  endpoint: string;
  appId: string;
  apiKey: string;
  stackId: string;
  bundleId: string;
  outputPath: string;
  appName?: string;
  keepSourcemaps: boolean;
  gzipContents: boolean;
  gzipPayload: boolean;
  verbose: boolean;
}

interface CurlOptions {
  endpoint: string;
  appId: string;
  apiKey: string;
  stackId: string;
  bundleId: string;
  file: string;
  appName?: string;
  contentType?: string;
  gzipPayload: boolean;
}

const program = new Command();

program
  .name('faro-cli')
  .description('CLI for uploading sourcemaps to the Faro source map API')
  .version('0.1.0');

program
  .command('upload')
  .description('Upload sourcemaps to the Faro source map API using cURL')
  .requiredOption('-e, --endpoint <url>', 'Faro API endpoint URL')
  .requiredOption('-a, --app-id <id>', 'Faro application ID')
  .requiredOption('-k, --api-key <key>', 'Faro API key')
  .requiredOption('-s, --stack-id <id>', 'Faro stack ID')
  .requiredOption('-b, --bundle-id <id>', 'Bundle ID (can be set via environment variable from bundler plugin)')
  .requiredOption('-o, --output-path <path>', 'Path to the directory containing sourcemaps')
  .option('-n, --app-name <n>', 'Application name (used to find bundleId in environment variables)')
  .option('-m, --keep-sourcemaps', 'Keep sourcemaps after uploading', false)
  .option('-g, --gzip-contents', 'Compress sourcemaps as a tarball before uploading', false)
  .option('-z, --gzip-payload', 'Gzip the HTTP payload for smaller uploads', false)
  .option('-v, --verbose', 'Enable verbose logging', false)
  .action(async (options: UploadOptions) => {
    try {
      // Check if bundleId is provided or should be read from environment variable
      let bundleId = options.bundleId;

      if (bundleId === 'env' && options.appName) {
        const envVarName = `FARO_BUNDLE_ID_${options.appName.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
        bundleId = process.env[envVarName] || '';

        if (!bundleId) {
          console.error(`Error: Bundle ID not found in environment variable ${envVarName}`);
          process.exit(1);
        }

        options.verbose && consoleInfoOrange(`Using bundleId ${bundleId} from environment variable ${envVarName}`);
      }

      // Resolve output path
      const outputPath = path.resolve(process.cwd(), options.outputPath);

      // Check if output path exists
      if (!fs.existsSync(outputPath)) {
        console.error(`Error: Output path ${outputPath} does not exist`);
        process.exit(1);
      }

      options.verbose && consoleInfoOrange(`Uploading sourcemaps from ${outputPath} to ${options.endpoint} using cURL${options.gzipPayload ? ' with gzipped payload' : ''}`);

      // Upload sourcemaps
      const success = await uploadSourceMaps(
        options.endpoint,
        options.appId,
        options.apiKey,
        options.stackId,
        bundleId,
        outputPath,
        {
          keepSourcemaps: options.keepSourcemaps,
          gzipContents: options.gzipContents,
          gzipPayload: options.gzipPayload,
          verbose: options.verbose,
        }
      );

      if (success) {
        consoleInfoOrange('Sourcemaps uploaded successfully');
      } else {
        console.error('Error: Failed to upload sourcemaps');
        process.exit(1);
      }
    } catch (err) {
      console.error('Error:', err);
      process.exit(1);
    }
  });

program
  .command('curl')
  .description('Generate a curl command for uploading sourcemaps')
  .requiredOption('-e, --endpoint <url>', 'Faro API endpoint URL')
  .requiredOption('-a, --app-id <id>', 'Faro application ID')
  .requiredOption('-k, --api-key <key>', 'Faro API key')
  .requiredOption('-s, --stack-id <id>', 'Faro stack ID')
  .requiredOption('-b, --bundle-id <id>', 'Bundle ID')
  .requiredOption('-f, --file <path>', 'Path to the sourcemap file')
  .option('-n, --app-name <name>', 'Application name (used to find bundleId in environment variables)')
  .option('-t, --content-type <type>', 'Content type for the upload', 'application/json')
  .option('-z, --gzip-payload', 'Generate a command that gzips the payload', false)
  .action((options: CurlOptions) => {
    try {
      // Check if bundleId is provided or should be read from environment variable
      let bundleId = options.bundleId;

      if (bundleId === 'env' && options.appName) {
        const envVarName = `FARO_BUNDLE_ID_${options.appName.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
        bundleId = process.env[envVarName] || '';

        if (!bundleId) {
          console.error(`Error: Bundle ID not found in environment variable ${envVarName}`);
          process.exit(1);
        }
      }

      // Resolve file path
      const filePath = path.resolve(process.cwd(), options.file);

      // Check if file exists
      if (!fs.existsSync(filePath)) {
        console.error(`Error: File ${filePath} does not exist`);
        process.exit(1);
      }

      // Generate curl command
      const curlCommand = generateCurlCommand(
        options.endpoint,
        options.appId,
        options.apiKey,
        options.stackId,
        bundleId,
        filePath,
        options.gzipPayload
      );

      console.log(`cURL command: ${options.gzipPayload ? 'gzip -c ' : ''}${curlCommand}`);
    } catch (err) {
      console.error('Error:', err);
      process.exit(1);
    }
  });

program.parse(process.argv);
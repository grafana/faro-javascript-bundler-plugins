import fs from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import { injectBundleId } from '../index';
import { faroBundleIdSnippet } from '@grafana/faro-bundlers-shared';

describe('injectBundleId', () => {
  const tempDir = path.join(tmpdir(), 'faro-cli-test-');
  let testDir: string;
  let testFiles: string[] = [];

  beforeEach(async () => {
    // Create a temporary directory for test files
    testDir = fs.mkdtempSync(tempDir);

    // Create test files
    const jsContent = 'console.log("Hello, world!");';
    const alreadyInjectedContent = faroBundleIdSnippet('existing-id', 'testapp') + jsContent;

    const file1 = path.join(testDir, 'test1.js');
    const file2 = path.join(testDir, 'test2.js');
    const file3 = path.join(testDir, 'already-injected.js');

    fs.writeFileSync(file1, jsContent);
    fs.writeFileSync(file2, jsContent);
    fs.writeFileSync(file3, alreadyInjectedContent);

    testFiles = [file1, file2, file3];
  });

  afterEach(() => {
    // Clean up test files
    testFiles.forEach((file) => {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    });

    // Remove test directory
    if (fs.existsSync(testDir)) {
      fs.rmdirSync(testDir);
    }
  });

  it('injects bundle ID into JavaScript files', async () => {
    const bundleId = 'test-bundle-id';
    const appName = 'testapp';
    const results = await injectBundleId(bundleId, appName, [testFiles[0], testFiles[1]]);

    // Verify both files were modified
    expect(results.length).toBe(2);
    expect(results[0].modified).toBe(true);
    expect(results[1].modified).toBe(true);

    // Verify content was modified correctly
    const content1 = fs.readFileSync(testFiles[0], 'utf8');
    const content2 = fs.readFileSync(testFiles[1], 'utf8');

    const expectedSnippet = faroBundleIdSnippet(bundleId, appName);
    expect(content1.startsWith(expectedSnippet)).toBe(true);
    expect(content2.startsWith(expectedSnippet)).toBe(true);
  });

  it('skips files that already have the bundle ID injected', async () => {
    const bundleId = 'new-bundle-id';
    const appName = 'testapp';
    const results = await injectBundleId(bundleId, appName, [testFiles[2]]);

    // Verify the file was not modified
    expect(results.length).toBe(1);
    expect(results[0].modified).toBe(false);

    // Verify content was not changed
    const content = fs.readFileSync(testFiles[2]).toString();
    expect(content).toContain('existing-id');
    expect(content).not.toContain(bundleId);
  });

  it('respects dry run mode', async () => {
    const bundleId = 'dry-run-test-id';
    const appName = 'testapp';
    const originalContent = fs.readFileSync(testFiles[0]).toString();

    const results = await injectBundleId(bundleId, appName, [testFiles[0]], { dryRun: true });

    // Verify result indicates modification would happen
    expect(results.length).toBe(1);
    expect(results[0].modified).toBe(true);

    // Verify file was not actually modified
    const afterContent = fs.readFileSync(testFiles[0]).toString();
    expect(afterContent).toBe(originalContent);
  });
});
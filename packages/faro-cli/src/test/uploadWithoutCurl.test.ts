import fs from 'fs';
import http from 'http';
import net from 'net';
import os from 'os';
import path from 'path';
import { gunzipSync } from 'zlib';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { runAndroidSymbolsUpload } from '../androidSymbols';
import { uploadCompressedSourceMaps, uploadSourceMap } from '../index';

interface Received {
  url: string;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

const PROXY_ENV = ['http_proxy', 'HTTP_PROXY', 'https_proxy', 'HTTPS_PROXY', 'no_proxy', 'NO_PROXY'];

// Forward proxy (absolute-form requests and CONNECT tunnels) that records each proxied request.
const startProxy = async () => {
  const requests: http.IncomingHttpHeaders[] = [];
  const server = http.createServer((req, res) => {
    requests.push(req.headers);
    const { 'proxy-authorization': _auth, ...headers } = req.headers;
    const upstream = http.request(req.url ?? '', { method: req.method, headers }, (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    });
    upstream.on('error', () => res.writeHead(502).end());
    req.pipe(upstream);
  });
  server.on('connect', (req: http.IncomingMessage, socket: net.Socket, head: Buffer) => {
    requests.push(req.headers);
    const [host, port] = (req.url ?? '').split(':');
    const upstream = net.connect(Number(port), host, () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as net.AddressInfo;
  return { server, requests, url: `http://127.0.0.1:${port}` };
};

describe('uploads without curl on PATH', () => {
  let server: http.Server;
  let endpoint: string;
  let received: Received[];
  let status: number;
  let tempDir: string;
  const savedPath = process.env.PATH;
  const savedProxyEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        received.push({ url: req.url ?? '', headers: req.headers, body: Buffer.concat(chunks) });
        res.writeHead(status).end(status === 401 ? 'invalid api key' : '{}');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    endpoint = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`;
  });

  afterAll(() => {
    server.close();
  });

  beforeEach(() => {
    received = [];
    status = 201;
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'faro-no-curl-'));
    for (const key of PROXY_ENV) {
      savedProxyEnv[key] = process.env[key];
      delete process.env[key];
    }
    // No curl binary can be found with an empty PATH.
    process.env.PATH = '';
  });

  afterEach(() => {
    process.env.PATH = savedPath;
    for (const key of PROXY_ENV) {
      if (savedProxyEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedProxyEnv[key];
      }
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  const writeMap = (name = 'app.js.map', content = '{"version":3,"mappings":""}') => {
    const filePath = path.join(tempDir, name);
    fs.writeFileSync(filePath, content);
    return filePath;
  };

  const baseOptions = (filePath: string) => ({
    endpoint,
    appId: 'app',
    apiKey: 'key',
    stackId: '42',
    bundleId: 'bundle',
    filePath,
    filename: path.basename(filePath),
    keepSourcemaps: true,
  });

  it('posts a sourcemap with auth and content-type headers', async () => {
    const filePath = writeMap();

    const ok = await uploadSourceMap(baseOptions(filePath));

    expect(ok).toBe(true);
    expect(received).toHaveLength(1);
    expect(received[0].url).toBe('/app/app/sourcemaps/bundle');
    expect(received[0].headers['authorization']).toBe('Bearer 42:key');
    expect(received[0].headers['content-type']).toBe('application/json');
    expect(received[0].headers['x-scope-orgid']).toBe('42');
    expect(received[0].headers['content-encoding']).toBeUndefined();
    expect(received[0].body.toString()).toBe(fs.readFileSync(filePath, 'utf8'));
  });

  it('gzips the payload and sets content-encoding when asked', async () => {
    const filePath = writeMap();

    const ok = await uploadSourceMap({ ...baseOptions(filePath), gzipPayload: true });

    expect(ok).toBe(true);
    expect(received[0].headers['content-type']).toBe('application/json');
    expect(received[0].headers['content-encoding']).toBe('gzip');
    expect(gunzipSync(received[0].body).toString()).toBe(fs.readFileSync(filePath, 'utf8'));
  });

  it('posts a tarball as application/gzip', async () => {
    const filePath = writeMap();

    const ok = await uploadCompressedSourceMaps({
      ...baseOptions(filePath),
      outputPath: tempDir,
      files: [filePath],
    });

    expect(ok).toBe(true);
    expect(received[0].headers['content-type']).toBe('application/gzip');
    expect(received[0].headers['content-encoding']).toBeUndefined();
    expect(gunzipSync(received[0].body).length).toBeGreaterThan(0);
  });

  it('reports the HTTP status and response body on failure', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    status = 401;

    const ok = await uploadSourceMap(baseOptions(writeMap()));

    expect(ok).toBe(false);
    const output = errorSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(output).toContain('source map upload failed with HTTP 401');
    expect(output).toContain('invalid api key');
  });

  it('tunnels through --proxy and sends --proxy-user as basic auth', async () => {
    const proxy = await startProxy();
    try {
      const ok = await uploadSourceMap({
        ...baseOptions(writeMap()),
        proxy: proxy.url,
        proxyUser: 'user:p@ss',
      });

      expect(ok).toBe(true);
      expect(received).toHaveLength(1);
      expect(proxy.requests).toHaveLength(1);
      expect(proxy.requests[0]['proxy-authorization']).toBe(
        `Basic ${Buffer.from('user:p@ss').toString('base64')}`
      );
    } finally {
      proxy.server.close();
    }
  });

  it('treats a --proxy without a scheme as http like curl', async () => {
    const proxy = await startProxy();
    try {
      const ok = await uploadSourceMap({
        ...baseOptions(writeMap()),
        proxy: proxy.url.replace('http://', ''),
      });

      expect(ok).toBe(true);
      expect(proxy.requests).toHaveLength(1);
    } finally {
      proxy.server.close();
    }
  });

  it('uses HTTP_PROXY from the environment and skips hosts in NO_PROXY', async () => {
    const proxy = await startProxy();
    const options = { ...baseOptions(writeMap()), proxyUser: 'user:pass' };
    try {
      process.env.HTTP_PROXY = proxy.url;
      expect(await uploadSourceMap(options)).toBe(true);
      expect(proxy.requests).toHaveLength(1);
      expect(proxy.requests[0]['proxy-authorization']).toBe(
        `Basic ${Buffer.from('user:pass').toString('base64')}`
      );

      process.env.NO_PROXY = '127.0.0.1';
      expect(await uploadSourceMap(options)).toBe(true);
      expect(proxy.requests).toHaveLength(1);
      expect(received).toHaveLength(2);
    } finally {
      proxy.server.close();
    }
  });

  it('uploads android mapping files as multipart form data', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const mapping = path.join(tempDir, 'mapping.txt');
    fs.writeFileSync(mapping, 'com.example.Foo -> a:\n');

    const code = await runAndroidSymbolsUpload({
      endpoint,
      appId: 'app',
      stackId: '42',
      apiKey: 'key',
      applicationId: 'com.example',
      versionCode: '1',
      versionName: '1.0',
      mapping,
      verbose: false,
      dryRun: false,
    });

    expect(code).toBe(0);
    expect(received).toHaveLength(1);
    expect(received[0].url).toBe('/app/app/symbols/android/com.example%401%401.0');
    expect(received[0].headers['authorization']).toBe('Bearer 42:key');
    expect(received[0].headers['content-type']).toMatch(/^multipart\/form-data; boundary=/);
    const body = received[0].body.toString();
    expect(body).toContain('name="mapping"; filename="mapping.txt"');
    expect(body).toContain('Content-Type: text/plain');
    expect(body).toContain('com.example.Foo -> a:');
  });
});

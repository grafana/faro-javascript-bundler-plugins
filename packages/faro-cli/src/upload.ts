import { EnvHttpProxyAgent, fetch, type RequestInit } from 'undici';

export interface PostResult {
  status: number;
  body: string;
}

const HAS_SCHEME = /^[a-z][a-z\d+.-]*:\/\//i;

/**
 * POSTs a body with fetch. Like curl, HTTP(S)_PROXY and NO_PROXY apply,
 * `proxy` overrides the env proxy and `proxyUser` ("user:password") is sent as Basic proxy auth.
 */
export const post = async (
  url: string,
  headers: Record<string, string>,
  body: RequestInit['body'],
  proxy?: string,
  proxyUser?: string
): Promise<PostResult> => {
  // curl treats a proxy without a scheme as http://
  const proxyUri = proxy && !HAS_SCHEME.test(proxy) ? `http://${proxy}` : proxy;
  const dispatcher = new EnvHttpProxyAgent({
    httpProxy: proxyUri,
    httpsProxy: proxyUri,
    token: proxyUser ? `Basic ${Buffer.from(proxyUser).toString('base64')}` : undefined,
  });

  try {
    const res = await fetch(url, { method: 'POST', headers, body, dispatcher });
    return { status: res.status, body: await res.text() };
  } finally {
    await dispatcher.close();
  }
};

import { EnvHttpProxyAgent, fetch, type RequestInit } from 'undici';

export interface PostResult {
  status: number;
  body: string;
}

const HAS_SCHEME = /^[a-z][a-z\d+.-]*:\/\//i;

// curl treats a proxy without a scheme as http://
const withScheme = (proxy?: string) => (proxy && !HAS_SCHEME.test(proxy) ? `http://${proxy}` : proxy);

/**
 * Formats an error with its cause, since fetch only says "fetch failed".
 * A refused connection can give an AggregateError with an empty message, so fall back to its code.
 */
export const describeError = (error: unknown): string => {
  if (!(error instanceof Error)) {
    return String(error);
  }
  const cause = error.cause as (Error & { code?: string }) | undefined;
  const reason = cause instanceof Error ? cause.message || cause.code : undefined;
  return reason ? `${error.message}: ${reason}` : error.message;
};

/**
 * POSTs a body with fetch. Like curl, HTTP(S)_PROXY and NO_PROXY apply,
 * `proxy` overrides the env proxy and `proxyUser` ("user:password") is sent as Basic proxy auth.
 * Like curl without -L, redirects are not followed and come back as a 3xx status.
 */
export const post = async (
  url: string,
  headers: Record<string, string>,
  body: RequestInit['body'],
  proxy?: string,
  proxyUser?: string
): Promise<PostResult> => {
  const { env } = process;
  const dispatcher = new EnvHttpProxyAgent({
    httpProxy: withScheme(proxy ?? env.http_proxy ?? env.HTTP_PROXY),
    httpsProxy: withScheme(proxy ?? env.https_proxy ?? env.HTTPS_PROXY),
    token: proxyUser ? `Basic ${Buffer.from(proxyUser).toString('base64')}` : undefined,
  });

  try {
    const res = await fetch(url, { method: 'POST', headers, body, dispatcher, redirect: 'manual' });
    const text = await res.text();
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location') ?? 'unknown location';
      return { status: res.status, body: `redirect to ${location} not followed` };
    }
    return { status: res.status, body: text };
  } finally {
    await dispatcher.close();
  }
};

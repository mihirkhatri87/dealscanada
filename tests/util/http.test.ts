import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  HttpClient,
  HttpError,
  RobotsDisallowedError,
  backoffDelay,
  parseRetryAfter,
} from '@/lib/util/http';

/**
 * These tests mock fetch entirely — the network guard in tests/setup.ts would
 * reject any real request, which is the point: adapters must never depend on the
 * live web to be verifiable.
 */

interface MockResponse {
  status?: number;
  body?: string;
  headers?: Record<string, string>;
}

let cacheDir: string;
let calls: string[];

function mockFetch(responses: Map<string, MockResponse | MockResponse[]>) {
  const remaining = new Map<string, MockResponse[]>();
  for (const [url, value] of responses) {
    remaining.set(url, Array.isArray(value) ? [...value] : [value]);
  }

  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push(url);

    const queue = remaining.get(url);
    const response = queue && queue.length > 1 ? queue.shift()! : (queue?.[0] ?? { status: 404 });

    const headers = new Headers(response.headers ?? {});
    return {
      status: response.status ?? 200,
      headers,
      text: async () => response.body ?? '',
    } as unknown as Response;
  });
}

function client(rps = 1000): HttpClient {
  return new HttpClient('DealsCanadaBot/0.1 (+https://example.test)', rps, cacheDir);
}

beforeEach(() => {
  cacheDir = mkdtempSync(join(tmpdir(), 'dc-http-'));
  calls = [];
});

afterEach(() => {
  rmSync(cacheDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('robots gating', () => {
  it('refuses a disallowed URL and never issues the request', async () => {
    globalThis.fetch = mockFetch(
      new Map([['https://shop.test/robots.txt', { body: 'User-agent: *\nDisallow: /private' }]]),
    );

    const http = client();
    await expect(http.fetchText('https://shop.test/private/x')).rejects.toBeInstanceOf(
      RobotsDisallowedError,
    );

    // Only robots.txt was fetched — the disallowed page was never requested.
    expect(calls).toEqual(['https://shop.test/robots.txt']);
  });

  it('allows a permitted URL', async () => {
    globalThis.fetch = mockFetch(
      new Map<string, MockResponse>([
        ['https://shop.test/robots.txt', { body: 'User-agent: *\nDisallow: /private' }],
        ['https://shop.test/deals', { body: 'ok' }],
      ]),
    );

    const response = await client().fetchText('https://shop.test/deals');
    expect(response.data).toBe('ok');
  });

  it('caches robots.txt across requests to the same origin', async () => {
    globalThis.fetch = mockFetch(
      new Map<string, MockResponse>([
        ['https://shop.test/robots.txt', { body: 'User-agent: *\nDisallow:' }],
        ['https://shop.test/a', { body: 'a' }],
        ['https://shop.test/b', { body: 'b' }],
      ]),
    );

    const http = client();
    await http.fetchText('https://shop.test/a', { cacheTtlMinutes: 0 });
    await http.fetchText('https://shop.test/b', { cacheTtlMinutes: 0 });

    expect(calls.filter((url) => url.endsWith('/robots.txt'))).toHaveLength(1);
  });

  it('proceeds when robots.txt is missing', async () => {
    globalThis.fetch = mockFetch(
      new Map<string, MockResponse>([
        ['https://shop.test/robots.txt', { status: 404 }],
        ['https://shop.test/deals', { body: 'ok' }],
      ]),
    );

    await expect(client().fetchText('https://shop.test/deals')).resolves.toMatchObject({
      data: 'ok',
    });
  });

  it('skips the robots gate for declared API endpoints', async () => {
    globalThis.fetch = mockFetch(
      new Map<string, MockResponse>([['https://api.test/v1/deals', { body: '{}' }]]),
    );

    await client().fetchText('https://api.test/v1/deals', { skipRobots: true });
    expect(calls).toEqual(['https://api.test/v1/deals']);
  });
});

describe('retry behaviour', () => {
  it('retries a 500 and succeeds on a later attempt', async () => {
    globalThis.fetch = mockFetch(
      new Map<string, MockResponse[]>([
        [
          'https://api.test/x',
          [{ status: 500 }, { status: 500 }, { status: 200, body: 'recovered' }],
        ],
      ]),
    );

    const response = await client().fetchText('https://api.test/x', {
      skipRobots: true,
      cacheTtlMinutes: 0,
      retryBaseMs: 1,
    });

    expect(response.data).toBe('recovered');
    expect(calls).toHaveLength(3);
  });

  it('gives up after the configured number of retries', async () => {
    globalThis.fetch = mockFetch(
      new Map<string, MockResponse>([['https://api.test/x', { status: 503 }]]),
    );

    await expect(
      client().fetchText('https://api.test/x', {
        skipRobots: true,
        maxRetries: 2,
        cacheTtlMinutes: 0,
        retryBaseMs: 1,
      }),
    ).rejects.toBeInstanceOf(HttpError);

    expect(calls).toHaveLength(3); // initial attempt plus two retries
  });

  it('does not retry a 404 — it is an answer, not a failure', async () => {
    globalThis.fetch = mockFetch(
      new Map<string, MockResponse>([['https://api.test/missing', { status: 404 }]]),
    );

    await expect(
      client().fetchText('https://api.test/missing', {
        skipRobots: true,
        cacheTtlMinutes: 0,
      }),
    ).rejects.toBeInstanceOf(HttpError);

    expect(calls).toHaveLength(1);
  });

  it('does not retry a 403 — the blocked case for Akamai-protected retailers', async () => {
    globalThis.fetch = mockFetch(
      new Map<string, MockResponse>([['https://walmart.test/api', { status: 403 }]]),
    );

    await expect(
      client().fetchText('https://walmart.test/api', {
        skipRobots: true,
        cacheTtlMinutes: 0,
      }),
    ).rejects.toMatchObject({ status: 403 });

    expect(calls).toHaveLength(1);
  });

  it('retries a 429 and honours Retry-After', async () => {
    globalThis.fetch = mockFetch(
      new Map<string, MockResponse[]>([
        [
          'https://api.test/x',
          [
            { status: 429, headers: { 'retry-after': '0' } },
            { status: 200, body: 'after backoff' },
          ],
        ],
      ]),
    );

    const response = await client().fetchText('https://api.test/x', {
      skipRobots: true,
      cacheTtlMinutes: 0,
      retryBaseMs: 1,
    });

    expect(response.data).toBe('after backoff');
  });
});

describe('caching and conditional requests', () => {
  it('serves a fresh cache hit without another request', async () => {
    globalThis.fetch = mockFetch(
      new Map<string, MockResponse>([['https://api.test/x', { body: 'first' }]]),
    );

    const http = client();
    const first = await http.fetchText('https://api.test/x', { skipRobots: true });
    const second = await http.fetchText('https://api.test/x', { skipRobots: true });

    expect(first.fromCache).toBe(false);
    expect(second.fromCache).toBe(true);
    expect(second.data).toBe('first');
    expect(calls).toHaveLength(1);
  });

  it('sends If-None-Match and serves the cached body on a 304', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      calls.push(url);

      const headers = new Headers((init?.headers ?? {}) as Record<string, string>);
      if (headers.get('If-None-Match') === 'v1') {
        return { status: 304, headers: new Headers(), text: async () => '' } as Response;
      }
      return {
        status: 200,
        headers: new Headers({ etag: 'v1' }),
        text: async () => 'cached body',
      } as Response;
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const http = client();
    await http.fetchText('https://api.test/x', { skipRobots: true, cacheTtlMinutes: 60 });

    // Expire the cache so the next call revalidates rather than serving locally.
    const revalidated = await http.fetchText('https://api.test/x', {
      skipRobots: true,
      cacheTtlMinutes: -1,
    });

    expect(revalidated.data).toBe('cached body');
    expect(revalidated.status).toBe(200);
  });

  it('bypasses the cache when the TTL is zero', async () => {
    globalThis.fetch = mockFetch(
      new Map<string, MockResponse>([['https://api.test/x', { body: 'x' }]]),
    );

    const http = client();
    await http.fetchText('https://api.test/x', { skipRobots: true, cacheTtlMinutes: 0 });
    await http.fetchText('https://api.test/x', { skipRobots: true, cacheTtlMinutes: 0 });

    expect(calls).toHaveLength(2);
  });
});

describe('fetchJson', () => {
  it('parses a JSON body', async () => {
    globalThis.fetch = mockFetch(
      new Map<string, MockResponse>([['https://api.test/j', { body: '{"deals":[{"id":1}]}' }]]),
    );

    const response = await client().fetchJson<{ deals: Array<{ id: number }> }>(
      'https://api.test/j',
      { skipRobots: true, cacheTtlMinutes: 0 },
    );

    expect(response.data.deals[0]?.id).toBe(1);
  });

  it('raises a clear error when the body is not JSON', async () => {
    globalThis.fetch = mockFetch(
      new Map<string, MockResponse>([
        ['https://api.test/html', { body: '<!doctype html><html>blocked</html>' }],
      ]),
    );

    await expect(
      client().fetchJson('https://api.test/html', { skipRobots: true, cacheTtlMinutes: 0 }),
    ).rejects.toThrow(/not valid JSON/);
  });
});

describe('identification', () => {
  it('sends the configured User-Agent on every request', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers((init?.headers ?? {}) as Record<string, string>);
      expect(headers.get('User-Agent')).toContain('DealsCanadaBot');
      return { status: 200, headers: new Headers(), text: async () => 'ok' } as Response;
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await client().fetchText('https://api.test/x', { skipRobots: true, cacheTtlMinutes: 0 });
    expect(fetchMock).toHaveBeenCalled();
  });
});

describe('helpers', () => {
  it('parses Retry-After as seconds and as a date', () => {
    expect(parseRetryAfter('30')).toBe(30_000);
    expect(parseRetryAfter(undefined)).toBeNull();
    expect(parseRetryAfter('not-a-thing')).toBeNull();

    const future = new Date(Date.now() + 5000).toUTCString();
    const parsed = parseRetryAfter(future);
    expect(parsed).toBeGreaterThan(0);
    expect(parsed).toBeLessThanOrEqual(5000);
  });

  it('grows backoff exponentially and caps it', () => {
    expect(backoffDelay(0, 500)).toBeGreaterThanOrEqual(500);
    expect(backoffDelay(0, 500)).toBeLessThan(1100);
    expect(backoffDelay(3, 500)).toBeGreaterThanOrEqual(4000);
    expect(backoffDelay(20, 500)).toBe(30_000);
  });
});

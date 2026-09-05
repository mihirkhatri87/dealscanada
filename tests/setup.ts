import { afterEach, beforeAll, vi } from 'vitest';

/**
 * Network guard.
 *
 * Every adapter in this project is written against documented response shapes and
 * tested with committed fixtures — no test is allowed to reach the real internet.
 * A test that does is either flaky, slow, or silently hitting a retailer's servers,
 * so we fail loudly rather than let it pass.
 *
 * Tests that need HTTP mock `globalThis.fetch` themselves; the guard only catches
 * the unmocked case.
 */
const ALLOWED_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

beforeAll(() => {
  const realFetch = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;

    let host: string;
    try {
      host = new URL(url).hostname;
    } catch {
      host = '';
    }

    if (ALLOWED_HOSTS.has(host)) {
      return realFetch(input as RequestInfo, init);
    }

    throw new Error(
      `Network access blocked in tests: ${url}\n` +
        `Tests must use committed fixtures under tests/fixtures/ and mock fetch. ` +
        `If you meant to test HTTP behaviour, mock globalThis.fetch in the test itself.`,
    );
  }) as typeof globalThis.fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

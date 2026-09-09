import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import '@/lib/sources/all';
import { allAdapters } from '@/lib/sources/registry';

/**
 * Scraping amazon.ca HTML violates Amazon's terms. That prohibition is worth
 * more than a comment: it is checked here across the whole project, so it
 * survives an adapter written months from now by someone who never read the PRD.
 */

const SOURCE_DIR = 'src/lib/sources';

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...sourceFiles(full));
    else if (full.endsWith('.ts')) found.push(full);
  }
  return found;
}

describe('the project never scrapes amazon.ca', () => {
  it('contains no amazon.ca product-page URL in any adapter', () => {
    // A canonical /dp/ link built for the shopper is fine and expected; a
    // fetchable listing or search URL is not.
    const offenders: string[] = [];

    for (const file of sourceFiles(SOURCE_DIR)) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/https?:\/\/[^\s'"`]*amazon\.(?:ca|com)[^\s'"`]*/gi)) {
        const url = match[0];
        // Building `https://www.amazon.ca/dp/<ASIN>` as an outbound link for the
        // shopper is the permitted case, and one every Amazon adapter needs.
        if (/\/dp\/(\$\{|[A-Z0-9]{10})/.test(url)) continue;
        // A bare origin in the catalogue is a directory entry, not a fetch — and
        // validateCatalogue refuses to enable it, which the test below asserts.
        if (file.endsWith('catalogue-data.ts') && /^https:\/\/www\.amazon\.ca$/.test(url)) {
          continue;
        }
        offenders.push(`${file}: ${url}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('issues no request to amazon.ca from any registered adapter', async () => {
    const requested: string[] = [];
    const record = vi.fn(async (url: string) => {
      requested.push(url);
      // Fail the request: this test is about what is asked for, not answered.
      throw new Error('blocked by the policy test');
    });

    for (const adapter of allAdapters()) {
      if (!adapter.enabled().enabled) continue;

      await adapter
        .fetch({
          http: {
            fetchText: record,
            fetchJson: record,
            // HEAD is a request like any other. Omitting it here would let an
            // adapter reach amazon.ca by a method this guard never watched.
            head: record,
            setDomainRate: vi.fn(),
          },
          log: vi.fn(),
          limit: 1,
        } as never)
        .catch(() => undefined);
    }

    expect(requested.length).toBeGreaterThan(0);
    for (const url of requested) {
      expect(url, `${url} must not be requested`).not.toMatch(/(^|\/\/|\.)amazon\.(ca|com)\//i);
    }
  });

  it('permits the static image CDN, and only for image paths', async () => {
    // m.media-amazon.com is a separate registrable domain serving static assets,
    // so hotlinking a product image is not the page scrape the terms forbid.
    // Spelled out here because the guard above passes it silently, and a silent
    // exemption is one nobody can review.
    const requested: string[] = [];
    const record = vi.fn(async (url: string) => {
      requested.push(url);
      throw new Error('blocked by the policy test');
    });

    for (const adapter of allAdapters()) {
      if (!adapter.enabled().enabled) continue;

      await adapter
        .fetch({
          http: { fetchText: record, fetchJson: record, head: record, setDomainRate: vi.fn() },
          log: vi.fn(),
          limit: 1,
        } as never)
        .catch(() => undefined);
    }

    for (const url of requested) {
      const { hostname, pathname } = new URL(url);
      if (!/amazon/i.test(hostname)) continue;

      expect(hostname, `${url} is not an approved Amazon host`).toBe('m.media-amazon.com');
      expect(pathname, `${url} is not an image path`).toMatch(/^\/images\//);
    }
  });
});

describe('the catalogue cannot be pointed at Amazon', () => {
  it('refuses an enabled amazon.ca entry, whatever engine it declares', async () => {
    const { validateCatalogue } = await import('@/lib/sources/catalogue');

    const { errors, valid } = validateCatalogue([
      {
        id: 'amazon',
        name: 'Amazon.ca',
        domain: 'amazon.ca',
        baseUrl: 'https://www.amazon.ca',
        engine: 'jsonld',
        enabled: true,
        salePaths: ['/deals'],
        productLinkSelector: 'a',
      },
    ]);

    // A disabled entry is not protection: it is one flag away from turning the
    // crawler loose. Flipping that flag has to fail here, not in production.
    expect(valid).toEqual([]);
    expect(errors.join(' ')).toContain('must not be crawled');
  });

  it('still allows the entry to exist for the brand directory', async () => {
    const { validateCatalogue } = await import('@/lib/sources/catalogue');

    const { errors, valid } = validateCatalogue([
      {
        id: 'amazon',
        name: 'Amazon.ca',
        domain: 'amazon.ca',
        baseUrl: 'https://www.amazon.ca',
        engine: 'jsonld',
        enabled: false,
      },
    ]);

    expect(errors).toEqual([]);
    expect(valid).toHaveLength(1);
  });
});

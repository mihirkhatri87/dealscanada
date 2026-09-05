import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  buildGridUrl,
  createSfccAdapter,
  detectSiteId,
  parseSfccGrid,
} from '@/lib/sources/engines/sfcc';
import type { RetailerConfig } from '@/lib/sources/catalogue';

const GRID = readFileSync(join(__dirname, '../fixtures/sfcc/search-grid.html'), 'utf8');

const options = {
  baseUrl: 'https://www.example-sfcc.ca',
  merchantDomain: 'example-sfcc.ca',
  merchantName: 'Example',
};

function config(overrides: Partial<RetailerConfig> = {}): RetailerConfig {
  return {
    id: 'example',
    name: 'Example',
    domain: 'example-sfcc.ca',
    baseUrl: 'https://www.example-sfcc.ca',
    engine: 'sfcc',
    status: 'unverified',
    enabled: true,
    ...overrides,
  } as RetailerConfig;
}

describe('parsing the search grid', () => {
  it('emits only genuinely discounted products', () => {
    const deals = parseSfccGrid(GRID, options);
    const titles = deals.map((deal) => deal.title);

    expect(titles).toContain("Women's Longline Puffer Jacket");
    expect(titles).toContain("Men's Merino Crew Sweater");

    // A full-price tee and a scarf whose "list" equals its "sale" are the
    // storefront, not a deal feed.
    expect(titles).not.toContain('Cotton Tee');
    expect(titles).not.toContain('Wool Scarf');
  });

  it('reads the exact price from the content attribute, not the rendered text', () => {
    // "$79.99" and "$199.00" would both survive a text parse, but the content
    // attribute is what makes currency symbols and separators irrelevant.
    const deal = parseSfccGrid(GRID, options).find((d) => d.title.includes('Puffer'));

    expect(deal?.price).toBe(79.99);
    expect(deal?.priceWas).toBe(199);
  });

  it('falls back to rendered text on an older storefront, French formatting included', () => {
    const deal = parseSfccGrid(GRID, options).find((d) => d.title.includes('Manteau'));

    expect(deal?.price).toBe(899.99);
    expect(deal?.priceWas).toBe(1299.99);
  });

  it('resolves relative product links against the storefront', () => {
    const deal = parseSfccGrid(GRID, options).find((d) => d.title.includes('Puffer'));
    expect(deal?.url).toBe('https://www.example-sfcc.ca/en_CA/womens-puffer-jacket/1234567.html');
  });

  it('prefers the lazy-loading data-src over the placeholder in src', () => {
    // Taking src would store a 1x1 placeholder as the product image on every
    // lazy-loaded grid, which is most of them.
    const deal = parseSfccGrid(GRID, options).find((d) => d.title.includes('Puffer'));
    expect(deal?.imageUrl).toBe('https://cdn.example-sfcc.ca/img/1234567.jpg');
  });

  it('uses src when there is no data-src', () => {
    const deal = parseSfccGrid(GRID, options).find((d) => d.title.includes('Merino'));
    expect(deal?.imageUrl).toBe('https://cdn.example-sfcc.ca/img/7654321.jpg');
  });

  it('keeps a discounted sold-out item, marked out of stock', () => {
    const deal = parseSfccGrid(GRID, options).find((d) => d.title.includes('Chelsea'));

    expect(deal).toBeDefined();
    expect(deal?.inStock).toBe(false);
  });

  it('collapses a product repeated within one grid', () => {
    const jackets = parseSfccGrid(GRID, options).filter((d) => d.title.includes('Puffer'));
    expect(jackets).toHaveLength(1);
  });

  it('carries the product id as an mpn for cross-merchant identity', () => {
    const deal = parseSfccGrid(GRID, options).find((d) => d.title.includes('Puffer'));
    expect(deal?.mpn).toBe('1234567');
  });

  it('takes the brand from the tile rather than guessing from the title', () => {
    const deal = parseSfccGrid(GRID, options).find((d) => d.title.includes('Puffer'));
    expect(deal?.brand).toBe('NorthPeak');
  });

  it('returns nothing for markup it does not recognise, rather than guessing', () => {
    expect(parseSfccGrid('<div><p>Nothing here</p></div>', options)).toEqual([]);
    expect(parseSfccGrid('', options)).toEqual([]);
  });
});

describe('site id detection', () => {
  it('reads the site id off any storefront URL in the page', () => {
    // Configuring this by hand is one more thing to keep correct; every SFCC page
    // names its own site somewhere.
    expect(detectSiteId(GRID)).toBe('ExampleCA');
  });

  it('returns null rather than a wrong guess', () => {
    expect(detectSiteId('<html><body>no demandware here</body></html>')).toBeNull();
  });
});

describe('the grid URL', () => {
  it('is the request the storefront makes of itself', () => {
    const url = buildGridUrl('https://www.example-sfcc.ca/', 'ExampleCA', 'en_CA', 'sale', 48, 48);

    expect(url).toContain('/on/demandware.store/Sites-ExampleCA-Site/en_CA/Search-UpdateGrid');
    expect(url).toContain('cgid=sale');
    expect(url).toContain('start=48');
    expect(url).toContain('sz=48');
  });
});

describe('the adapter', () => {
  function context(fetchText: (url: string) => Promise<{ data: string }>) {
    return {
      http: { fetchText: vi.fn(fetchText), fetchJson: vi.fn() },
      log: vi.fn(),
      limit: 100,
    } as never;
  }

  it('resolves the site id from the storefront when the catalogue does not pin one', async () => {
    const seen: string[] = [];
    const result = await createSfccAdapter(config()).fetch(
      context(async (url) => {
        seen.push(url);
        return { data: GRID };
      }),
    );

    expect(seen[0]).toBe('https://www.example-sfcc.ca');
    expect(seen[1]).toContain('Sites-ExampleCA-Site');
    expect(result.deals.length).toBeGreaterThan(0);
  });

  it('skips the discovery request when the site id is pinned', async () => {
    const seen: string[] = [];
    await createSfccAdapter(config({ sfccSiteId: 'PinnedCA' })).fetch(
      context(async (url) => {
        seen.push(url);
        return { data: GRID };
      }),
    );

    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain('Sites-PinnedCA-Site');
  });

  it('reports an unresolvable site id rather than throwing', async () => {
    // A site id that no longer resolves marks the retailer blocked with a reason;
    // it must never take the run down with it.
    const result = await createSfccAdapter(config()).fetch(
      context(async () => ({ data: '<html>nothing</html>' })),
    );

    expect(result.deals).toEqual([]);
    expect(result.reason).toContain('site id');
  });

  it('reports a failed fetch rather than throwing', async () => {
    const result = await createSfccAdapter(config({ sfccSiteId: 'X' })).fetch(
      context(async () => {
        throw new Error('HTTP 403');
      }),
    );

    expect(result.deals).toEqual([]);
    expect(result.reason).toContain('403');
  });

  it('honours the locale the catalogue names', async () => {
    const seen: string[] = [];
    await createSfccAdapter(config({ sfccSiteId: 'X', sfccLocale: 'fr_CA' })).fetch(
      context(async (url) => {
        seen.push(url);
        return { data: GRID };
      }),
    );

    expect(seen[0]).toContain('/fr_CA/Search-UpdateGrid');
  });

  it('is skipped, not failed, when the catalogue disables it', () => {
    expect(createSfccAdapter(config({ enabled: false })).enabled()).toMatchObject({
      enabled: false,
    });
  });
});

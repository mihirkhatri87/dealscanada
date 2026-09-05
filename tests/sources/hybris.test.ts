import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildSearchUrl,
  createHybrisAdapter,
  parseHybrisSearch,
  resolvePrice,
} from '@/lib/sources/engines/hybris';
import type { RetailerConfig } from '@/lib/sources/catalogue';

const SEARCH = JSON.parse(
  readFileSync(join(__dirname, '../fixtures/hybris/search.json'), 'utf8'),
) as unknown;

const options = {
  bannerDomain: 'canadiantire.ca',
  bannerName: 'Canadian Tire',
  baseUrl: 'https://www.canadiantire.ca',
};

function config(overrides: Partial<RetailerConfig> = {}): RetailerConfig {
  return {
    id: 'canadian-tire',
    name: 'Canadian Tire',
    domain: 'canadiantire.ca',
    baseUrl: 'https://www.canadiantire.ca',
    engine: 'hybris',
    status: 'unverified',
    enabled: true,
    family: 'canadian-tire',
    salePaths: ['CLEARANCE'],
    ...overrides,
  } as RetailerConfig;
}

describe('resolving which number a shopper actually pays', () => {
  it('takes a plain markdown at face value', () => {
    const price = resolvePrice({
      currentPrice: { value: 89.99 },
      originalPrice: { value: 199.99 },
    });

    expect(price).toMatchObject({ kind: 'sale', headline: 89.99, was: 199.99, note: null });
  });

  it('refuses to divide a multi-buy into a per-unit headline', () => {
    // "2 for $30" is not a $15 item. Someone buying one pays the regular price,
    // and that is most people.
    const price = resolvePrice({
      currentPrice: { value: 15 },
      originalPrice: { value: 24.99 },
      priceMessage: [{ label: '2 for $30' }],
    });

    expect(price.kind).toBe('multi-buy');
    expect(price.headline).toBe(15);
    expect(price.note).toContain('full quantity');
  });

  it('does not promote a member-only price to the headline', () => {
    // A member price is real but conditional. As the headline it advertises a
    // saving a non-member walking in cannot get.
    const price = resolvePrice({
      currentPrice: { value: 19.99 },
      originalPrice: { value: 39.99 },
      isMemberPrice: true,
    });

    expect(price.kind).toBe('member-only');
    expect(price.headline).toBe(39.99);
    expect(price.was).toBeNull();
    expect(price.note).toContain('members only');
  });

  it('detects a member price from the promo text alone', () => {
    const price = resolvePrice({
      currentPrice: { value: 10 },
      originalPrice: { value: 20 },
      badges: ['Triangle Members Only'],
    });

    expect(price.kind).toBe('member-only');
  });

  it('reads a current price equal to the regular one as no sale', () => {
    const price = resolvePrice({
      currentPrice: { value: 44.99 },
      originalPrice: { value: 44.99 },
    });

    expect(price.kind).toBe('regular');
    expect(price.was).toBeNull();
  });

  it('never treats a higher current price as a discount', () => {
    const price = resolvePrice({ currentPrice: { value: 50 }, originalPrice: { value: 40 } });
    expect(price.was).toBeNull();
  });

  it('reads a price given as a bare number or a string', () => {
    expect(resolvePrice({ currentPrice: 12.5, originalPrice: 25 }).headline).toBe(12.5);
    expect(resolvePrice({ currentPrice: '$12.50', originalPrice: '$25.00' }).headline).toBe(12.5);
  });
});

describe('parsing a search response', () => {
  it('emits genuinely discounted products', () => {
    const titles = parseHybrisSearch(SEARCH, options).map((deal) => deal.title);

    expect(titles).toContain('Mastercraft Socket Set, 200-pc');
    expect(titles).toContain('Michelin X-Ice Snow Winter Tire 205/55R16');
  });

  it('drops an item at its regular price', () => {
    const titles = parseHybrisSearch(SEARCH, options).map((deal) => deal.title);
    expect(titles).not.toContain('Yardworks Garden Hose, 50 ft');
  });

  it('drops a member-only offer with no underlying markdown', () => {
    // The member price is not a markdown anyone can walk in and get, so listing
    // it would fill the feed with items at their normal shelf price.
    const titles = parseHybrisSearch(SEARCH, options).map((deal) => deal.title);
    expect(titles).not.toContain('NOMA LED String Lights, 100-ct');
  });

  it('keeps a multi-buy item at its single-unit price, with the offer described', () => {
    const deal = parseHybrisSearch(SEARCH, options).find((d) => d.title.includes('Wiper'));

    expect(deal?.price).toBe(15);
    expect(deal?.priceWas).toBe(24.99);
    expect(deal?.stockNote).toContain('2 for $30');
  });

  it('keeps a sold-out clearance item, marked out of stock', () => {
    const deal = parseHybrisSearch(SEARCH, options).find((d) => d.title.includes('Sleeping Bag'));

    expect(deal).toBeDefined();
    expect(deal?.inStock).toBe(false);
  });

  it('skips a product with no code, which cannot be upserted stably', () => {
    const titles = parseHybrisSearch(SEARCH, options).map((deal) => deal.title);
    expect(titles).not.toContain('Product With No Code');
  });

  it('collapses a product repeated in one response', () => {
    const sets = parseHybrisSearch(SEARCH, options).filter((d) => d.title.includes('Socket Set'));
    expect(sets).toHaveLength(1);
  });

  it('resolves product and image URLs against the banner', () => {
    const deal = parseHybrisSearch(SEARCH, options).find((d) => d.title.includes('Socket Set'));

    expect(deal?.url).toBe(
      'https://www.canadiantire.ca/en/pdp/mastercraft-socket-set-200-pc-0871234p.html',
    );
    expect(deal?.imageUrl).toBe('https://www.canadiantire.ca/media/product/0871234P.jpg');
  });

  it('takes the brand from the payload', () => {
    const deal = parseHybrisSearch(SEARCH, options).find((d) => d.title.includes('Socket Set'));
    expect(deal?.brand).toBe('Mastercraft');
  });

  it('never presents a banner SKU as a manufacturer part number', () => {
    // Their codes are banner-scoped. Emitting one as an mpn would let the
    // verification engine match it against another retailer's unrelated part
    // number and compare two different products.
    const deal = parseHybrisSearch(SEARCH, options).find((d) => d.title.includes('Socket Set'));
    expect(deal?.mpn).toBeNull();
  });

  it('returns nothing for a shape it does not recognise', () => {
    expect(parseHybrisSearch({ unexpected: true }, options)).toEqual([]);
    expect(parseHybrisSearch(null, options)).toEqual([]);
  });
});

describe('the search URL', () => {
  it('is store-scoped, because this platform prices by store', () => {
    const url = buildSearchUrl('https://apim.canadiantire.ca/v1', 'sportchek', 'SALE', '211', 0);

    expect(url).toContain('/search/v2/search');
    expect(url).toContain('store=211');
    expect(url).toContain('baseStoreId=sportchek');
    expect(url).toContain('categoryCode=SALE');
  });
});

describe('the adapter', () => {
  const original = process.env['CANADIAN_TIRE_API_KEY'];

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (original === undefined) delete process.env['CANADIAN_TIRE_API_KEY'];
    else process.env['CANADIAN_TIRE_API_KEY'] = original;
  });

  it('is skipped, not failed, when no API key is configured', () => {
    // There is no public developer programme for this key. The whole family
    // being red would say "broken" about something that is merely unconfigured,
    // and would colour a run that is otherwise fine.
    const gate = createHybrisAdapter(config()).enabled();

    if (!process.env['CANADIAN_TIRE_API_KEY']) {
      expect(gate).toMatchObject({ enabled: false });
      expect('reason' in gate && gate.reason).toContain('CANADIAN_TIRE_API_KEY');
      expect('reason' in gate && gate.reason).toContain('JSON-LD');
    }
  });

  it('is skipped when the catalogue disables it', () => {
    expect(createHybrisAdapter(config({ enabled: false })).enabled()).toMatchObject({
      enabled: false,
      reason: 'disabled in catalogue',
    });
  });

  it('yields nothing without a key rather than calling the API', async () => {
    const fetchJson = vi.fn();
    const result = await createHybrisAdapter(config()).fetch({
      http: { fetchJson, fetchText: vi.fn() },
      log: vi.fn(),
    } as never);

    if (!process.env['CANADIAN_TIRE_API_KEY']) {
      expect(fetchJson).not.toHaveBeenCalled();
      expect(result.deals).toEqual([]);
      expect(result.reason).toContain('no API key');
    }
  });
});

describe('the adapter with a key configured', () => {
  it('sends the subscription key and maps the response', async () => {
    // The no-key path is the common one, but it exercises none of the fetch or
    // mapping code — so the configured path gets its own run with the config
    // module mocked, rather than being left untested until someone supplies a key.
    vi.resetModules();
    vi.doMock('@/lib/config', async () => {
      const actual = await vi.importActual<typeof import('@/lib/config')>('@/lib/config');
      return { ...actual, env: { ...actual.env, CANADIAN_TIRE_API_KEY: 'test-key' } };
    });

    const { createHybrisAdapter: create } = await import('@/lib/sources/engines/hybris');

    const calls: Array<{ url: string; headers?: Record<string, string> }> = [];
    const result = await create(config()).fetch({
      http: {
        fetchJson: vi.fn(async (url: string, opts?: { headers?: Record<string, string> }) => {
          calls.push({ url, ...(opts?.headers ? { headers: opts.headers } : {}) });
          return { data: SEARCH };
        }),
        fetchText: vi.fn(),
      },
      log: vi.fn(),
      storeIds: ['211'],
    } as never);

    expect(calls[0]?.headers?.['ocp-apim-subscription-key']).toBe('test-key');
    // The user's selected store, not the default: this platform prices by store.
    expect(calls[0]?.url).toContain('store=211');
    expect(result.deals.length).toBeGreaterThan(0);
    expect(result.path).toBe('search-api');

    vi.doUnmock('@/lib/config');
    vi.resetModules();
  });

  it('reports a rejected key rather than throwing', async () => {
    vi.resetModules();
    vi.doMock('@/lib/config', async () => {
      const actual = await vi.importActual<typeof import('@/lib/config')>('@/lib/config');
      return { ...actual, env: { ...actual.env, CANADIAN_TIRE_API_KEY: 'wrong-key' } };
    });

    const { createHybrisAdapter: create } = await import('@/lib/sources/engines/hybris');

    const result = await create(config()).fetch({
      http: {
        fetchJson: vi.fn(async () => {
          throw new Error('HTTP 401 Access denied due to invalid subscription key');
        }),
        fetchText: vi.fn(),
      },
      log: vi.fn(),
    } as never);

    // A rejected key must read as this banner's problem, with the reason
    // visible — never as an exception that ends the run for everyone else.
    expect(result.deals).toEqual([]);
    expect(result.reason).toContain('401');

    vi.doUnmock('@/lib/config');
    vi.resetModules();
  });
});
